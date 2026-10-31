import { resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';

export const ROOT = resolve(import.meta.dirname, '../../..');

// An agent's shell inherits this from Claude Desktop. Electron would attach to that app's crash handler,
// and a crash would drop its dump in that app's folder.
const { CHROME_CRASHPAD_PIPE_NAME: _parentCrashHandler, ...parentEnv } = process.env;

export type AppPaths = {
  userData: string;
  dataRoot: string;
  /** Extra Chromium switches. */
  switches?: string[];
  /** Replaces the silent output, for a test of what a failing one does. It still has to be silent. */
  mpvArgs?: string;
};

export function launchApp({
  userData,
  dataRoot,
  switches = [],
  mpvArgs = '--ao=null',
}: AppPaths): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.', `--user-data-dir=${userData}`, ...switches],
    cwd: ROOT,
    env: { ...parentEnv, MUSIC_PLAYER_DATA_DIR: dataRoot, MUSIC_PLAYER_MPV_ARGS: mpvArgs },
  });
}

export function stubFolderDialog(app: ElectronApplication, folder: string | null) {
  return app.evaluate(({ dialog }, picked) => {
    const answer = { canceled: picked === null, filePaths: picked === null ? [] : [picked] };
    dialog.showOpenDialog = () => Promise.resolve(answer);
  }, folder);
}

/** Lets the page catch up: a resize reaches the virtual lists a frame or two later, and art takes a moment to decode. */
export async function settled(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const frame = () => new Promise((done) => requestAnimationFrame(done));
    await document.fonts.ready;
    await frame();
    await frame();

    const inView = [...document.images].filter((image) => {
      const { top, bottom } = image.getBoundingClientRect();
      return bottom > 0 && top < innerHeight;
    });
    const decoded = Promise.all(inView.map((image) => image.decode().catch(() => {})));
    await Promise.race([decoded, new Promise((done) => setTimeout(done, 5_000))]);
    await frame();
  });
}

/**
 * Resizes the real window. `page.setViewportSize` would only fake it: the title bar's env() values keep following the
 * real window, and the header leaves room for the window controls by comparing them with 100vw.
 */
export async function resizeWindow(app: ElectronApplication, page: Page, width: number, height: number): Promise<void> {
  const setSize = async (contentWidth: number, contentHeight: number) => {
    await app.evaluate(
      ({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(size.contentWidth, size.contentHeight);
      },
      { contentWidth, contentHeight },
    );
    await page.waitForFunction(
      ([w, h]) => Math.abs(innerWidth - (w ?? 0)) <= 1 && Math.abs(innerHeight - (h ?? 0)) <= 1,
      [width, height],
    );
  };

  await setSize(width, height);
  // At some display scales the content comes out a pixel short of what was asked for.
  const short = await page.evaluate(([w, h]) => [(w ?? 0) - innerWidth, (h ?? 0) - innerHeight], [width, height]);
  if (short[0] !== 0 || short[1] !== 0) await setSize(width + (short[0] ?? 0), height + (short[1] ?? 0));
  await settled(page);
}

/** Fires an event at the page as if main had sent it, for a state too brief to catch for real. */
export function sendEvent(app: ElectronApplication, name: string, payload: unknown) {
  return app.evaluate(
    ({ BrowserWindow }, event) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send(`event:${event.name}`, event.payload);
    },
    { name, payload },
  );
}

/** The whole window as the OS sees it, native controls included, which a page screenshot leaves out. */
export async function captureRealWindow(app: ElectronApplication): Promise<Buffer> {
  const base64 = await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error('No window to capture');
    const { width, height } = win.getBounds();
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width, height } });
    const source = sources.find(({ id }) => id === win.getMediaSourceId());
    if (!source) throw new Error('The window is not among the capturable sources');
    return source.thumbnail.toPNG().toString('base64');
  });
  return Buffer.from(base64, 'base64');
}
