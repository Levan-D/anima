import { join } from 'node:path';
import { app, BrowserWindow, Menu, screen, type WebContents, type WebPreferences } from 'electron';
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
/** At an interface size of 100%: the art, two lines of text, six 44px controls and room for the volume bar over the text. */
const MINI_WIDTH = 620;
/** At an interface size of 100%: the strip is the whole window. */
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

/** The packaged exe carries build/icon.ico already. This one is for the window, in development too. */
function appIcon(): string {
  return join(
    app.isPackaged ? process.resourcesPath : app.getAppPath(),
    app.isPackaged ? '' : 'resources',
    'icons',
    'app.png',
  );
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
    // The start of Tailwind's @sm container size: narrower, the library has no layout that works.
    minWidth: 384,
    minHeight: 400,
    show: false,
    icon: appIcon(),
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
  const strip = miniPlayerBounds(
    settings.miniPlayerPosition(),
    { width: Math.round(MINI_WIDTH * scale), height: Math.round(MINI_HEIGHT * scale) },
    screen.getAllDisplays().map((display) => display.workArea),
    screen.getPrimaryDisplay().workArea,
  );
  const win = new BrowserWindow({
    ...strip,
    useContentSize: true,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Music Player',
    icon: appIcon(),
    backgroundColor: WINDOW_BACKGROUND,
    webPreferences: webPreferences(),
  });
  miniWindow = win;

  win.once('ready-to-show', () => {
    // The first size and place are the frame's, and every later one is the page's.
    win.setContentBounds(strip);
    win.show();
    mainWindow?.hide();
  });
  win.on('show', () => onTaskbarWindow(win));
  win.on('moved', () => {
    const { x, y } = win.getContentBounds();
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
