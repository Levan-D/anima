import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  screen,
  type OpenDialogOptions,
  type WebContents,
  type WebPreferences,
} from 'electron';
import { MINI_WINDOW_HASH, type WindowState } from '@shared/domain';
import { ok } from '@shared/result';
import type { HandlerGroup } from '@main/ipc';
import type { SettingsStore } from '@main/settings/settings';
import { log } from '@main/system/logging';
import { APP_ENTRY_URL } from '@main/system/protocolUrls';
import { initialBounds, miniPlayerBounds } from '@main/system/windowBounds';

/** The same near-black as --color-neutral-950 in globals.css. */
export const WINDOW_BACKGROUND = '#0a0a0a';
const WINDOW_SYMBOLS = '#ededed';
/** The native window controls are touch targets too, so this matches the 44px floor. */
const TITLE_BAR_HEIGHT = 44;
/** At an interface size of 100%: the art, two lines of text and four 44px controls. */
const MINI_WIDTH = 440;
const MINI_HEIGHT = 80;

type WindowEvents = {
  onStateChange: (state: WindowState) => void;
  /** This window has just got a taskbar button. Only the visible one has any. */
  onTaskbarWindow: (win: BrowserWindow) => void;
};

let mainWindow: BrowserWindow | null = null;
let miniWindow: BrowserWindow | null = null;
let isQuitting = false;

export function rendererUrl(): string {
  const devServer = process.env.ELECTRON_RENDERER_URL;
  return !app.isPackaged && devServer ? devServer : APP_ENTRY_URL;
}

/** Where to bring this window back to, if it ever leaves the app. */
export function homeUrlOf(contents: WebContents): string {
  const isMini = miniWindow !== null && !miniWindow.isDestroyed() && miniWindow.webContents === contents;
  return isMini ? `${rendererUrl()}${MINI_WINDOW_HASH}` : rendererUrl();
}

function currentState(): WindowState {
  return {
    isFullscreen: mainWindow?.isFullScreen() ?? false,
    isMiniPlayer: miniWindow !== null,
    isHidden: mainWindow ? mainWindow.isMinimized() || !mainWindow.isVisible() : false,
  };
}

function webPreferences(): WebPreferences {
  return {
    preload: join(app.getAppPath(), 'out', 'preload', 'index.cjs'),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webviewTag: false,
    // The silent audio element and the position relay must keep running while the window is in the background.
    backgroundThrottling: false,
  };
}

function showMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

let openMini: () => void = () => {};

export function openMainWindow(settings: SettingsStore, events: WindowEvents, onFirstLoad: () => void): void {
  const { onStateChange, onTaskbarWindow } = events;
  const saved = settings.windowBounds();
  const win = new BrowserWindow({
    ...initialBounds(
      saved,
      screen.getAllDisplays().map((display) => display.workArea),
      screen.getPrimaryDisplay().workArea,
    ),
    minWidth: 320,
    minHeight: 400,
    show: false,
    backgroundColor: WINDOW_BACKGROUND,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: WINDOW_SYMBOLS, height: TITLE_BAR_HEIGHT },
    webPreferences: webPreferences(),
  });
  mainWindow = win;
  openMini = () => openMiniWindow(settings, events);
  app.once('before-quit', () => {
    isQuitting = true;
  });

  if (saved?.isMaximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('show', () => onTaskbarWindow(win));

  const saveBounds = () => settings.setWindowBounds({ ...win.getNormalBounds(), isMaximized: win.isMaximized() });
  win.on('resized', saveBounds);
  win.on('moved', saveBounds);
  win.on('maximize', saveBounds);
  win.on('unmaximize', saveBounds);
  win.on('close', saveBounds);
  win.on('closed', () => {
    mainWindow = null;
    // Otherwise the mini would hold the app open with no session and nothing to return to.
    miniWindow?.destroy();
  });

  const reportState = () => onStateChange(currentState());
  win.on('enter-full-screen', reportState);
  win.on('leave-full-screen', reportState);
  win.on('minimize', reportState);
  win.on('restore', reportState);
  win.on('hide', reportState);
  win.on('show', reportState);

  win.webContents.on('before-input-event', (event, input) => {
    if (app.isPackaged || input.type !== 'keyDown' || input.key !== 'F12') return;
    event.preventDefault();
    win.webContents.toggleDevTools();
  });

  win.webContents.once('did-stop-loading', onFirstLoad);
  win.loadURL(rendererUrl()).catch((error: unknown) => log.error('Could not load the renderer', error));
}

/**
 * The main window goes out of sight and stays alive, because it holds the media session. The mini is closed rather than
 * hidden when it's done with, so nothing runs behind it, and closing it any way at all brings the main window back.
 */
function openMiniWindow(settings: SettingsStore, { onStateChange, onTaskbarWindow }: WindowEvents): void {
  if (miniWindow) {
    miniWindow.focus();
    return;
  }

  // The tokens grow with the interface size, so the window has to as well. Below 100% the 44px floor doesn't shrink.
  const scale = Math.max(settings.get().uiScale, 1);
  const win = new BrowserWindow({
    ...miniPlayerBounds(
      settings.miniPlayerPosition(),
      { width: Math.round(MINI_WIDTH * scale), height: Math.round(MINI_HEIGHT * scale) },
      screen.getAllDisplays().map((display) => display.workArea),
      screen.getPrimaryDisplay().workArea,
    ),
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    title: 'Music Player',
    backgroundColor: WINDOW_BACKGROUND,
    webPreferences: webPreferences(),
  });
  miniWindow = win;

  win.once('ready-to-show', () => {
    win.show();
    mainWindow?.hide();
  });
  win.on('show', () => onTaskbarWindow(win));
  win.on('moved', () => {
    const { x, y } = win.getBounds();
    settings.setMiniPlayerPosition({ x, y });
  });
  win.on('closed', () => {
    miniWindow = null;
    if (!isQuitting) showMainWindow();
    onStateChange(currentState());
  });

  // On anything that isn't a drag region. Those get the system menu, whose Close returns to the main window.
  win.webContents.on('context-menu', () => {
    Menu.buildFromTemplate([
      { label: 'Return to the main window', click: () => win.close() },
      { label: 'Quit', click: () => app.quit() },
    ]).popup({ window: win });
  });

  win
    .loadURL(`${rendererUrl()}${MINI_WINDOW_HASH}`)
    .catch((error: unknown) => log.error('Could not load the mini player', error));
  onStateChange(currentState());
}

export function focusMainWindow(): void {
  if (miniWindow) miniWindow.close();
  else showMainWindow();
}

/** Null when cancelled. */
export async function pickEqFile(): Promise<string | null> {
  const options: OpenDialogOptions = {
    title: 'Import an equalizer preset',
    defaultPath: app.getPath('documents'),
    filters: [{ name: 'Equalizer APO preset', extensions: ['txt'] }],
    properties: ['openFile'],
  };
  const owner = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await (owner
    ? dialog.showOpenDialog(owner, options)
    : dialog.showOpenDialog(options));
  return canceled ? null : (filePaths[0] ?? null);
}

export async function pickEqSavePath(suggestedName: string): Promise<string | null> {
  const options = {
    title: 'Export an equalizer preset',
    defaultPath: join(app.getPath('documents'), suggestedName),
    filters: [{ name: 'Equalizer APO preset', extensions: ['txt'] }],
  };
  const owner = BrowserWindow.getFocusedWindow();
  const { canceled, filePath } = await (owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options));
  return canceled || filePath === '' ? null : filePath;
}

export async function pickLyricsLibrary(): Promise<string | null> {
  const options: OpenDialogOptions = {
    title: 'Choose a lyrics library',
    defaultPath: app.getPath('documents'),
    filters: [{ name: 'Lyrics library', extensions: ['db'] }],
    properties: ['openFile'],
  };
  const owner = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await (owner
    ? dialog.showOpenDialog(owner, options)
    : dialog.showOpenDialog(options));
  return canceled ? null : (filePaths[0] ?? null);
}

/** Null when cancelled. Electron would default to Downloads, so the starting folder is always given. */
export async function pickFolder(defaultPath: string | null): Promise<string | null> {
  const options: OpenDialogOptions = {
    title: 'Choose your music folder',
    defaultPath: defaultPath ?? app.getPath('music'),
    properties: ['openDirectory'],
  };
  const owner = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await (owner
    ? dialog.showOpenDialog(owner, options)
    : dialog.showOpenDialog(options));
  return canceled ? null : (filePaths[0] ?? null);
}

export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

export const windowHandlers = {
  'window.state': () => ok(currentState()),
  'window.toggleFullscreen': () => {
    mainWindow?.setFullScreen(!mainWindow.isFullScreen());
    return ok();
  },
  'window.setMiniPlayer': ({ enabled }) => {
    if (enabled) openMini();
    else miniWindow?.close();
    return ok();
  },
} satisfies HandlerGroup;
