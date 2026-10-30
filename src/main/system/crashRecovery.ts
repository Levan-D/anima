import { app, BrowserWindow, dialog, type MessageBoxOptions, type WebContents } from 'electron';
import { log } from '@main/system/logging';

const RELOAD_LIMIT = 3;
const RELOAD_WINDOW_MS = 60_000;
const QUIT_BUTTON = 1;

/** Lets a crashed renderer come back, without looping forever when it dies on load. */
export function createReloadGuard(limit = RELOAD_LIMIT, windowMs = RELOAD_WINDOW_MS) {
  let reloads: number[] = [];
  return (now: number): boolean => {
    reloads = reloads.filter((time) => now - time < windowMs);
    if (reloads.length >= limit) return false;
    reloads.push(now);
    return true;
  };
}

async function askWhatToDo(contents: WebContents): Promise<void> {
  const options: MessageBoxOptions = {
    type: 'error',
    message: 'The window keeps crashing.',
    detail: 'It was reloaded a few times and crashed again. The details are in the log.',
    buttons: ['Reload', 'Quit'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  const owner = BrowserWindow.fromWebContents(contents);
  const { response } = await (owner ? dialog.showMessageBox(owner, options) : dialog.showMessageBox(options));

  if (response === QUIT_BUTTON) app.quit();
  else if (!contents.isDestroyed()) contents.reload();
}

export function startCrashRecovery(): void {
  const mayReload = createReloadGuard();

  app.on('render-process-gone', (_event, contents, details) => {
    if (details.reason === 'clean-exit' || contents.isDestroyed()) return;
    if (mayReload(Date.now())) {
      contents.reload();
      return;
    }
    log.error('Renderer keeps crashing, asking what to do');
    askWhatToDo(contents).catch((error: unknown) => log.error('Could not ask about the crashes', error));
  });
}
