import { join } from 'node:path';
import { app, BrowserWindow, dialog, screen, type OpenDialogOptions } from 'electron';
import type { WindowState } from '@shared/domain';
import { ok } from '@shared/result';
import type { HandlerGroup } from '@main/ipc';
import type { SettingsStore } from '@main/settings/settings';
import { log } from '@main/system/logging';
import { APP_ENTRY_URL } from '@main/system/protocolUrls';
import { initialBounds } from '@main/system/windowBounds';

/** The same near-black as --color-neutral-950 in globals.css. */
export const WINDOW_BACKGROUND = '#0a0a0a';
const WINDOW_SYMBOLS = '#ededed';
/** The native window controls are touch targets too, so this matches the 44px floor. */
const TITLE_BAR_HEIGHT = 44;

let mainWindow: BrowserWindow | null = null;

export function rendererUrl(): string {
  const devServer = process.env.ELECTRON_RENDERER_URL;
  return !app.isPackaged && devServer ? devServer : APP_ENTRY_URL;
}

function currentState(): WindowState {
  return {
    isFullscreen: mainWindow?.isFullScreen() ?? false,
    isMiniPlayer: false,
    isHidden: mainWindow ? mainWindow.isMinimized() || !mainWindow.isVisible() : false,
  };
}

export function openMainWindow(
  settings: SettingsStore,
  onStateChange: (state: WindowState) => void,
  onFirstLoad: () => void,
): void {
  const saved = settings.windowBounds();
  const win = new BrowserWindow({
    ...initialBounds(
      saved,
      screen.getAllDisplays().map((display) => display.workArea),
      screen.getPrimaryDisplay().workArea,
    ),
    minWidth: 640,
    minHeight: 480,
    show: false,
    backgroundColor: WINDOW_BACKGROUND,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: WINDOW_SYMBOLS, height: TITLE_BAR_HEIGHT },
    webPreferences: {
      preload: join(app.getAppPath(), 'out', 'preload', 'index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      // The silent audio element and the position relay must keep running while the window is in the background.
      backgroundThrottling: false,
    },
  });
  mainWindow = win;

  if (saved?.isMaximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  const saveBounds = () => settings.setWindowBounds({ ...win.getNormalBounds(), isMaximized: win.isMaximized() });
  win.on('resized', saveBounds);
  win.on('moved', saveBounds);
  win.on('maximize', saveBounds);
  win.on('unmaximize', saveBounds);
  win.on('close', saveBounds);
  win.on('closed', () => {
    mainWindow = null;
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

export function focusMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
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
} satisfies HandlerGroup;
