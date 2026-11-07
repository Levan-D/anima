import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { APP_DIR, launchApp, resizeWindow, ROOT, settled, stubFolderDialog } from './helpers/app';
import { generatedLibrary } from './helpers/generatedLibrary';

const DEV = join(ROOT, '.dev');
const E2E = join(DEV, 'e2e');
const USER_DATA = join(E2E, 'user-data');
const MUSIC = join(E2E, 'Music');
const SCREENSHOTS = join(DEV, 'screenshots', 'phase1');

const APP_URL = 'app://bundle/index.html';

const VIEWPORTS = [
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '2560x1440', width: 2560, height: 1440 },
  { name: '3840x2160', width: 3840, height: 2160 },
  { name: '900x1200-portrait', width: 900, height: 1200 },
  { name: '640x1600-tall', width: 640, height: 1600 },
  { name: '640x480-minimum', width: 640, height: 480 },
  { name: '1023x600-list-only', width: 1023, height: 600 },
  { name: '1024x600-beside', width: 1024, height: 600 },
  { name: '1000x800-near-square', width: 1000, height: 800 },
  { name: '1200x800-three-by-two', width: 1200, height: 800 },
  { name: '1024x640-laptop-at-125', width: 1024, height: 640 },
  { name: '853x533-laptop-at-150', width: 853, height: 533 },
  { name: '960x540-tv-at-200', width: 960, height: 540 },
  { name: '768x614-laptop-at-167', width: 768, height: 614 },
];

const UI_SCALES = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.25];

// The second-launch test starts Electron by hand, and needs the same clean environment as launchApp.
const { CHROME_CRASHPAD_PIPE_NAME: _parentCrashHandler, ...parentEnv } = process.env;

let app: ElectronApplication;
let page: Page;
const problems: string[] = [];

/** Sizes of the regions the design cares about, in CSS pixels. */
function measure(target: Page) {
  return target.evaluate(() => {
    const rect = (element: Element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    const box = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Nothing matches ${selector}`);
      return rect(element);
    };
    return {
      window: { width: innerWidth, height: innerHeight },
      art: box('[data-testid="art"]'),
      list: box('main'),
      transport: box('footer'),
      scroller: box('[data-testid="list-scroller"]'),
      tabList: box('[role="tablist"]'),
      tab: box('[role="tab"]'),
      tabs: [...document.querySelectorAll('[role="tab"]')].map(rect),
      activeTab: box('[role="tab"][data-state="active"]'),
      row: box('[data-testid="list-row"]'),
      isRowTight: document.querySelector('[data-testid="list-row"]')?.hasAttribute('data-tight') ?? false,
      strip: box('[data-testid="title-bar"]'),
      search: box('label:has(input[aria-label="Search your library"])'),
      gear: box('[aria-label="Settings"]'),
      // TypeScript's DOM types don't have the Window Controls Overlay API yet.
      controlsStartAt: (() => {
        const area = (
          navigator as Navigator & { windowControlsOverlay: { getTitlebarAreaRect(): DOMRect } }
        ).windowControlsOverlay.getTitlebarAreaRect();
        return area.x + area.width;
      })(),
      bodyText: Number.parseFloat(getComputedStyle(document.body).fontSize),
      overflowsX: document.documentElement.scrollWidth > innerWidth,
    };
  });
}

type Measured = Awaited<ReturnType<typeof measure>>;

/** What has to hold at any window size and interface size. */
function expectUsable({
  window,
  art,
  list,
  transport,
  scroller,
  tabList,
  tab,
  tabs,
  activeTab,
  row,
  isRowTight,
  strip,
  search,
  gear,
  controlsStartAt,
  overflowsX,
}: Measured) {
  expect(overflowsX).toBe(false);

  expect(art.width).toBeCloseTo(art.height, 1);
  // Art only ever sits beside the list, from lg up. Narrower, it's the list alone.
  if (window.width >= 1024) expect(art.height).toBeGreaterThan(0);
  else expect(art.height).toBe(0);
  expect(art.x).toBeGreaterThanOrEqual(0);
  expect(art.y).toBeGreaterThanOrEqual(0);
  expect(art.x + art.width).toBeLessThanOrEqual(window.width);
  expect(art.y + art.height).toBeLessThanOrEqual(window.height);

  // Nothing slides under the window controls. The strip scrolls sideways when it's short, but the tab in use is in it.
  expect(tab.y).toBeGreaterThanOrEqual(strip.height);
  expect(activeTab.x).toBeGreaterThanOrEqual(tabList.x);
  expect(activeTab.x + activeTab.width).toBeLessThanOrEqual(tabList.x + tabList.width + 1);
  for (const { y, height } of tabs) {
    expect(y).toBeGreaterThanOrEqual(tabList.y);
    expect(y + height).toBeLessThanOrEqual(tabList.y + tabList.height);
  }
  expect(tabList.x).toBeGreaterThanOrEqual(list.x);
  expect(tabList.x + tabList.width).toBeLessThanOrEqual(list.x + list.width);

  // The search field is at least a finger wide: in a tight row it folds to its icon, and opens out when it has focus.
  // Nothing sits under the window controls.
  expect(search.width).toBeGreaterThanOrEqual(44);
  expect(search.y >= strip.height || search.x + search.width <= controlsStartAt).toBe(true);
  expect(gear.y >= strip.height || gear.x + gear.width <= controlsStartAt).toBe(true);

  expect(tab.height).toBeGreaterThanOrEqual(44);
  // The Tracks tab's rows are packed like foobar2000's, under the tap floor on purpose, and have a floor of their own.
  expect(row.height).toBeGreaterThanOrEqual(isRowTight ? 28 : 44);
  expect(scroller.height / row.height).toBeGreaterThanOrEqual(2.5);
  expect(transport.y + transport.height).toBeCloseTo(window.height, 1);
}

async function setUiScale(target: Page, uiScale: number) {
  await target.evaluate((value) => window.api.invoke('settings.update', { uiScale: value }), uiScale);
  await target.waitForFunction(
    (value) => document.documentElement.style.getPropertyValue('--ui-scale') === String(value),
    uiScale,
  );
  await settled(target);
}

function launch(userData: string) {
  return launchApp({ userData, dataRoot: join(E2E, 'data') });
}

/** A skeleton, which is what loops in this app, and only while something's loading. */
function addSomethingLooping(target: Page) {
  return target.evaluate(() => {
    const looping = document.createElement('div');
    looping.className = 'animate-skeleton';
    looping.dataset.testLooping = '';
    document.body.append(looping);
  });
}

function removeSomethingLooping(target: Page) {
  return target.evaluate(() => document.querySelector('[data-test-looping]')?.remove());
}

function readLog(userData: string): string {
  return readFileSync(join(userData, 'logs', 'main.log'), 'utf8');
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(300_000);
  rmSync(E2E, { recursive: true, force: true });
  mkdirSync(SCREENSHOTS, { recursive: true });
  await generatedLibrary(MUSIC);

  app = await launch(USER_DATA);
  page = await app.firstWindow();
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  // The listeners above can miss the first load, so load it once more with them attached.
  await page.waitForLoadState('load');
  await page.reload();
  await page.getByRole('heading', { name: 'Point me at your music' }).waitFor();
});

test.afterAll(async () => {
  await app.close();
});

test('opens a window without errors', async () => {
  await expect(page).toHaveTitle('Music Player');
  // It shows on ready-to-show, which reaches main a moment after the page has what's waited for above.
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible()))
    .toBe(true);
  expect(page.url()).toBe(APP_URL);
  expect(problems).toEqual([]);
});

test('keeps its data inside the --user-data-dir', async () => {
  const paths = await app.evaluate(({ app: electronApp }) => ({
    userData: electronApp.getPath('userData'),
    crashDumps: electronApp.getPath('crashDumps'),
    crashHandler: process.env.CHROME_CRASHPAD_PIPE_NAME ?? null,
  }));
  expect(paths.userData).toBe(USER_DATA);
  expect(paths.crashDumps.startsWith(USER_DATA)).toBe(true);
  expect(paths.crashHandler).toBeNull();
  expect(readLog(USER_DATA)).toContain('Binaries');
});

test('loads the bundled font, and paints the page the same color as the window', async () => {
  const look = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      font: [...document.fonts].some(({ family, status }) => family.includes('Inter Variable') && status === 'loaded'),
      background: getComputedStyle(document.body).backgroundColor,
    };
  });
  const windowBackground = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.getBackgroundColor(),
  );

  expect(look.font).toBe(true);
  expect(look.background).toBe('rgb(10, 10, 10)');
  expect(windowBackground?.toLowerCase()).toBe('#0a0a0a');
});

test('exposes the typed api and nothing from Node', async () => {
  const globals = await page.evaluate(() => ({
    apiKeys: Object.keys(window.api).sort(),
    require: typeof (globalThis as { require?: unknown }).require,
    process: typeof (globalThis as { process?: unknown }).process,
    buffer: typeof (globalThis as { Buffer?: unknown }).Buffer,
  }));
  expect(globals).toEqual({
    apiKeys: ['invoke', 'on'],
    require: 'undefined',
    process: 'undefined',
    buffer: 'undefined',
  });
});

test('answers commands with a Result', async () => {
  const settings = await page.evaluate(() => window.api.invoke('settings.get'));
  expect(settings).toMatchObject({ ok: true, value: { libraryFolder: null, volume: 100, uiScale: 1 } });

  const status = await page.evaluate(() => window.api.invoke('library.status'));
  expect(status).toEqual({ ok: true, value: { state: 'no-folder' } });

  const player = await page.evaluate(() => window.api.invoke('player.state'));
  expect(player).toMatchObject({ ok: true, value: { status: 'idle', current: null, volume: 100 } });

  const windowState = await page.evaluate(() => window.api.invoke('window.state'));
  expect(windowState).toEqual({ ok: true, value: { isFullscreen: false, isMiniPlayer: false, isHidden: false } });

  const noLibrary = await page.evaluate(() => window.api.invoke('library.artists'));
  expect(noLibrary).toMatchObject({ ok: false, error: { code: 'no_library' } });

  const badInput = await page.evaluate(() => window.api.invoke('settings.update', { uiScale: 99 }));
  expect(badInput).toMatchObject({ ok: false, error: { code: 'invalid_input' } });

  const unknown = await page.evaluate(() => window.api.invoke('nope' as 'settings.get'));
  expect(unknown).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
});

test('points at a generated library, which everything below needs', async () => {
  await stubFolderDialog(app, MUSIC);
  await page.getByRole('button', { name: 'Choose a folder' }).click();
  await page.getByRole('tab', { name: 'Albums', exact: true }).click();
  await page.getByRole('tab', { name: 'Albums' }).waitFor();
  await expect
    .poll(
      async () => {
        const state = await page.evaluate(() => window.api.invoke('scan.state'));
        return state.ok ? state.value.phase : 'failed';
      },
      { timeout: 120_000 },
    )
    .toBe('idle');

  // Rows have a height the layout tests can measure. The grid's cards don't count as list rows.
  await page.getByRole('tab', { name: 'Tracks', exact: true }).click();
  await page.getByTestId('list-row').first().waitFor();
});

test('delivers events and unsubscribes, handing nothing of the emitter back', async () => {
  const { seen, unsubscribed } = await page.evaluate(async () => {
    const received: number[] = [];
    const unsubscribe = window.api.on('settings.changed', ({ uiScale }) => received.push(uiScale));
    await window.api.invoke('settings.update', { uiScale: 1.25 });
    while (received.length === 0) await new Promise((resolve) => setTimeout(resolve, 10));
    const returned = typeof unsubscribe();

    await window.api.invoke('settings.update', { uiScale: 1 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { seen: received, unsubscribed: returned };
  });
  expect(seen).toEqual([1.25]);
  expect(unsubscribed).toBe('undefined');
});

test('refuses commands from a page that is not the app', async () => {
  const replies = await app.evaluate(
    async ({ BrowserWindow }, preload) => {
      const foreign = new BrowserWindow({ show: false, webPreferences: { preload } });
      // Stands in for a window that got away: the app's own guard would bring it straight back.
      foreign.webContents.removeAllListeners('did-navigate');

      const results: unknown[] = [];
      for (const url of ['data:text/html,x', 'app://elsewhere/index.html']) {
        await foreign.loadURL(url);
        results.push(
          await foreign.webContents.executeJavaScript('window.api.invoke("settings.get")'),
          await foreign.webContents.executeJavaScript('window.api.invoke("settings.update", { uiScale: 2 })'),
        );
      }
      foreign.destroy();
      return results;
    },
    join(APP_DIR, 'out', 'preload', 'index.cjs'),
  );

  expect(replies).toHaveLength(4);
  for (const reply of replies) expect(reply).toMatchObject({ ok: false, error: { code: 'unexpected' } });
  expect(await page.evaluate(() => window.api.invoke('settings.get'))).toMatchObject({ value: { uiScale: 1 } });
});

test('blocks navigation to another origin', async () => {
  await page.evaluate(() => {
    location.href = 'https://example.invalid/';
  });
  await page.waitForTimeout(500);
  expect(page.url()).toBe(APP_URL);
  expect(await page.evaluate(() => document.querySelector('[role="tab"]') !== null)).toBe(true);

  // Playwright keeps waiting for the navigation it saw start, and a reload makes it let go.
  await page.reload();
  await page.getByRole('tab', { name: 'Albums' }).waitFor();
  await page.getByRole('tab', { name: 'Tracks', exact: true }).click();
  await page.getByTestId('list-row').first().waitFor();
});

test('comes back when the page takes itself to about:blank', async () => {
  await page.evaluate(() => {
    setTimeout(() => {
      location.href = 'about:blank';
    });
  });
  await expect.poll(() => readLog(USER_DATA)).toContain('about:blank');
  await expect.poll(() => page.url()).toBe(APP_URL);
  await page.getByRole('tab', { name: 'Albums' }).waitFor();
  await page.getByRole('tab', { name: 'Tracks', exact: true }).click();
  await page.getByTestId('list-row').first().waitFor();
});

test('denies new windows', async () => {
  const opened = await page.evaluate(() => window.open('https://example.invalid/') === null);
  expect(opened).toBe(true);
  expect(app.windows()).toHaveLength(1);
});

test('denies permission requests', async () => {
  const state = await page.evaluate(async () => {
    const { state: geolocation } = await navigator.permissions.query({ name: 'geolocation' });
    return geolocation;
  });
  expect(state).toBe('denied');
});

test('guards the bundle and art protocols', async () => {
  const statuses = await app.evaluate(async ({ net }) => {
    const status = async (url: string) => (await net.fetch(url)).status;
    return {
      entry: await status('app://bundle/index.html'),
      missing: await status('app://bundle/nope.js'),
      escape: await status('app://bundle/..%2f..%2fpackage.json'),
      otherHost: await status('app://elsewhere/index.html'),
      art: await status('art://thumb/0123456789abcdef'),
      badArt: await status('art://huge/not-a-hash'),
    };
  });
  expect(statuses).toEqual({ entry: 200, missing: 404, escape: 404, otherHost: 404, art: 404, badArt: 404 });
});

test('a second launch exits and leaves the first window alone', async () => {
  const require = createRequire(import.meta.url);
  const electronPath = require('electron') as string;
  const exitCode = await new Promise<number | null>((done) => {
    const second = execFile(electronPath, ['.', `--user-data-dir=${USER_DATA}`], {
      cwd: ROOT,
      timeout: 30_000,
      env: parentEnv,
    });
    second.on('exit', done);
  });
  expect(exitCode).toBe(0);
  expect(app.windows()).toHaveLength(1);
});

test('renders at every window size', async () => {
  for (const { name, width, height } of VIEWPORTS) {
    await resizeWindow(app, page, width, height);
    await page.screenshot({ path: join(SCREENSHOTS, `${name}.png`), animations: 'disabled' });

    const measured = await measure(page);
    expect(measured.window.width).toBe(width);
    // The window's minimum height comes out a pixel over at some display scales.
    expect(Math.abs(measured.window.height - height)).toBeLessThanOrEqual(1);
    expectUsable(measured);
  }
  expect(problems).toEqual([]);
});

test('proportions hold', async () => {
  await resizeWindow(app, page, 1280, 800);
  const laptop = await measure(page);
  expect(laptop.art).toMatchObject({ x: 0, y: 0, width: 800, height: 800 });
  expect(laptop.list.width / 1280).toBeGreaterThanOrEqual(0.36);

  await resizeWindow(app, page, 1920, 1080);
  const desktop = await measure(page);
  expect(desktop.art).toMatchObject({ x: 0, y: 0, width: 1080, height: 1080 });

  await resizeWindow(app, page, 3840, 2160);
  const tv = await measure(page);
  expect(tv.art).toMatchObject({ x: 0, y: 0, width: 2160, height: 2160 });
  expect(tv.row.height / desktop.row.height).toBeCloseTo(2, 1);
  expect(tv.tab.height / desktop.tab.height).toBeCloseTo(2, 1);
  expect(tv.tab.width / desktop.tab.width).toBeCloseTo(2, 1);

  // lg is where the art comes in beside the list, as tall as the window, as long as the list keeps @md's 448.
  await resizeWindow(app, page, 1024, 600);
  const beside = await measure(page);
  // Narrower than the window is tall, so it sits in the middle of the height.
  expect(beside.art).toMatchObject({ x: 0, y: (600 - 576) / 2, width: 576, height: 576 });
  expect(beside.list.width).toBe(448);
  await resizeWindow(app, page, 1024, 800);
  expect((await measure(page)).list.width).toBe(448);

  // Under it, portrait or not, the list has the whole window.
  for (const [width, height] of [
    [1023, 600],
    [900, 1200],
  ] as const) {
    await resizeWindow(app, page, width, height);
    const listOnly = await measure(page);
    expect(listOnly.art.height).toBe(0);
    expect(listOnly.list.width).toBe(listOnly.window.width);
  }

  // The smallest window the app allows still has a usable list.
  await resizeWindow(app, page, 640, 480);
  const smallest = await measure(page);
  expect(smallest.scroller.height / smallest.row.height).toBeGreaterThanOrEqual(2.9);
});

test('a long title on the art stays inside the art', async () => {
  const tracks = await page.evaluate(async () => {
    const result = await window.api.invoke('library.tracks', { filter: { kind: 'all' } });
    return result.ok ? result.value : [];
  });
  const bare = tracks.find(({ artHash }) => artHash === null);
  await page.evaluate((id) => window.api.invoke('player.play', { trackIds: [id ?? 0], startIndex: 0 }), bare?.id);
  await resizeWindow(app, page, 1280, 800);
  const onTheSleeve = page.getByTestId('art').locator('.art-fallback .text-cover');
  await onTheSleeve.waitFor();

  for (const [width, height] of [
    [1024, 600],
    [1280, 800],
    [1920, 1080],
  ] as const) {
    await resizeWindow(app, page, width, height);
    const before = await measure(page);
    const after = await page.evaluate(() => {
      const art = document.querySelector('[data-testid="art"]') as Element;
      const title = art.querySelector('.art-fallback .text-cover') as Element;
      const original = title.textContent;
      title.textContent = 'Antidisestablishmentarianism';
      const { x, y, width: artWidth, height: artHeight } = art.getBoundingClientRect();
      const box = title.getBoundingClientRect();
      title.textContent = original;
      return {
        art: { x, y, width: artWidth, height: artHeight },
        titleFits: box.left >= x && box.top >= y && box.right <= x + artWidth && box.bottom <= y + artHeight,
      };
    });
    expect(after.art).toEqual(before.art);
    expect(after.titleFits).toBe(true);
  }
  await page.evaluate(() => window.api.invoke('player.clearQueue'));
});

test('a keyboard-focused tab shows its whole ring', async () => {
  await resizeWindow(app, page, 1280, 800);
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  for (let presses = 0; presses < 20; presses++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => document.activeElement?.getAttribute('role') === 'tab')) break;
  }
  const focused = await page.evaluate(() => {
    const element = document.activeElement as Element;
    return {
      role: element.getAttribute('role'),
      visible: element.matches(':focus-visible'),
      // The strip scrolls sideways and clips anything outside it, so the ring goes inside the tab.
      isInside: Number.parseFloat(getComputedStyle(element).outlineOffset) < 0,
    };
  });
  expect(focused).toEqual({ role: 'tab', visible: true, isInside: true });
  await page.screenshot({ path: join(SCREENSHOTS, 'focus-tab.png'), animations: 'disabled' });
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
});

test('the window controls have room above the tabs', async () => {
  await resizeWindow(app, page, 1280, 800);
  const { strip, tab } = await measure(page);
  expect(strip).toMatchObject({ y: 0, height: 44 });
  expect(tab.y).toBeGreaterThanOrEqual(44);

  const titleBar = await page.evaluate(() => {
    // TypeScript's DOM types don't have the Window Controls Overlay API yet.
    const overlay = (
      navigator as Navigator & { windowControlsOverlay: { visible: boolean; getTitlebarAreaRect(): DOMRect } }
    ).windowControlsOverlay;
    const { width, height } = overlay.getTitlebarAreaRect();
    return { visible: overlay.visible, width, height };
  });
  expect(titleBar.visible).toBe(true);
  expect(titleBar.height).toBe(44);
});

test('the interface-size setting scales everything, as far as the window can take', async () => {
  const measureAt = async (width: number, height: number, uiScale: number) => {
    await resizeWindow(app, page, width, height);
    await setUiScale(page, uiScale);
    return measure(page);
  };

  for (const [width, height] of [
    [3840, 2160],
    [1920, 1080],
    [1280, 800],
    [1000, 800],
  ] as const) {
    const base = await measureAt(width, height, 1);
    for (const uiScale of [1.25, 1.5]) {
      const scaled = await measureAt(width, height, uiScale);
      expect(scaled.row.height / base.row.height).toBeCloseTo(uiScale, 1);
      expect(scaled.bodyText / base.bodyText).toBeCloseTo(uiScale, 1);
    }
  }

  // 1280x800 can show up to 800/480 of the base size, and the setting stops there.
  const limit = 800 / 480;
  const base = await measureAt(1280, 800, 1);
  const atTheLimit = await measureAt(1280, 800, 2.25);
  expect(atTheLimit.bodyText / base.bodyText).toBeCloseTo(limit, 1);

  // The smallest window has no room to spare.
  const smallest = await measureAt(640, 480, 1);
  expect((await measureAt(640, 480, 2.25)).row).toEqual(smallest.row);

  await setUiScale(page, 1);
});

test('the interface-size setting never breaks the layout, and never shrinks the floors', async () => {
  for (const { name, width, height } of VIEWPORTS) {
    await resizeWindow(app, page, width, height);
    for (const uiScale of UI_SCALES) {
      await setUiScale(page, uiScale);
      const measured = await measure(page);
      if (uiScale === 2 && width < 1400) {
        await page.screenshot({ path: join(SCREENSHOTS, `scale-2-${name}.png`), animations: 'disabled' });
      }
      expectUsable(measured);
      expect(measured.bodyText).toBeGreaterThanOrEqual(14);
    }
  }
  await setUiScale(page, 1);
});

test('respects reduced motion', async () => {
  await resizeWindow(app, page, 1280, 800);
  await addSomethingLooping(page);
  const readMotion = () =>
    page.evaluate(() => ({
      button: getComputedStyle(document.querySelector('[role="tab"]') as Element).transitionDuration,
      looping: document.getAnimations().some((animation) => animation.effect?.getTiming().iterations === Infinity),
    }));

  const before = await readMotion();
  expect(before.button).not.toBe('0s');
  expect(before.looping).toBe(true);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await readMotion()).toEqual({ button: '0s', looping: false });

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await removeSomethingLooping(page);
});

test('stops looping animations while the window is minimized', async () => {
  const looping = () =>
    page.evaluate(() =>
      document
        .getAnimations()
        .some(({ effect, playState }) => effect?.getTiming().iterations === Infinity && playState === 'running'),
    );
  const isMarkedHidden = (expected: boolean) =>
    page.waitForFunction((value) => document.documentElement.hasAttribute('data-window-hidden') === value, expected, {
      polling: 100,
    });

  // Playwright's screenshots replay animations from script, which detaches them from animation-play-state for good.
  await page.reload();
  await page.getByRole('tab', { name: 'Albums' }).waitFor();
  await addSomethingLooping(page);
  await expect.poll(looping).toBe(true);

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.minimize());
  await isMarkedHidden(true);
  await expect.poll(looping).toBe(false);

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.restore());
  await isMarkedHidden(false);
  await expect.poll(looping).toBe(true);
  await removeSomethingLooping(page);
});

test('the accent eases to a new color', async () => {
  const readAccent = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent'));
  const start = await readAccent();

  await page.evaluate(() => document.documentElement.style.setProperty('--accent', '#ff0000'));
  const midway = await readAccent();
  await expect.poll(readAccent, { timeout: 3000 }).toBe('rgb(255, 0, 0)');

  await page.evaluate(() => document.documentElement.style.removeProperty('--accent'));
  await expect.poll(readAccent, { timeout: 3000 }).toBe(start);

  expect(midway).not.toBe('rgb(255, 0, 0)');
});

test('lets the page read art, which the media overlay needs as a data URL', async () => {
  const status = await page.evaluate(async () => (await fetch('art://thumb/0123456789abcdef')).status);
  expect(status).toBe(404);
});

test('the CSP is the strict one, and blocks inline scripts', async () => {
  const content = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  const directives = Object.fromEntries(
    (content ?? '').split('; ').map((directive): [string, string[]] => {
      const [name = '', ...values] = directive.split(' ');
      return [name, values.filter((value) => !value.startsWith("'sha256-"))];
    }),
  );
  expect(directives).toEqual({
    'default-src': ["'none'"],
    'script-src': ["'self'"],
    'style-src': ["'self'"],
    'img-src': ["'self'", 'art:', 'data:', 'blob:'],
    'media-src': ["'self'", 'blob:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'", 'art:'],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
  });

  problems.length = 0;
  const ran = await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.__inlineScriptRan = true';
    document.head.append(script);
    return '__inlineScriptRan' in window;
  });
  expect(ran).toBe(false);
  expect(problems.join()).toContain('Content Security Policy');
});

test('logs renderer errors through main, and survives them', async () => {
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('e2e renderer failure');
    });
  });
  await expect.poll(() => readLog(USER_DATA)).toContain('e2e renderer failure');
  await expect(page.getByRole('tab', { name: 'Albums' })).toBeVisible();
});

test('logs uncaught errors in main, and survives them', async () => {
  await app.evaluate(() => {
    setTimeout(() => {
      throw new Error('e2e main failure');
    });
  });
  await expect.poll(() => readLog(USER_DATA)).toContain('e2e main failure');
  expect(await page.evaluate(() => window.api.invoke('window.state'))).toMatchObject({ ok: true });
});

// These two crash the page, so everything that uses `page` has to stay above them.
async function crashAndWaitForThePage() {
  const crashesLogged = () => readLog(USER_DATA).split('Renderer gone').length - 1;
  const before = crashesLogged();

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.forcefullyCrashRenderer();
  });
  await expect.poll(crashesLogged).toBeGreaterThan(before);

  await expect
    .poll(
      () =>
        app.evaluate(({ BrowserWindow }) => {
          const contents = BrowserWindow.getAllWindows()[0]?.webContents;
          if (!contents || contents.isCrashed() || contents.isLoading()) return false;
          return contents
            .executeJavaScript('document.querySelector(\'[role="tab"]\') !== null')
            .catch(() => false) as Promise<boolean>;
        }),
      { timeout: 15_000 },
    )
    .toBe(true);
}

test('reloads the page when the renderer crashes', async () => {
  await crashAndWaitForThePage();
});

test('asks what to do when the renderer keeps crashing', async () => {
  // Playwright can't reach a native dialog, so this answers it, picking Reload.
  await app.evaluate(({ dialog }) => {
    const shown = { count: 0 };
    Object.assign(globalThis, { crashDialogs: shown });
    dialog.showMessageBox = () => {
      shown.count++;
      return Promise.resolve({ response: 0, checkboxChecked: false });
    };
  });
  const dialogsShown = () =>
    app.evaluate(() => (globalThis as unknown as { crashDialogs: { count: number } }).crashDialogs.count);

  for (let crashes = 0; crashes < 4 && (await dialogsShown()) === 0; crashes++) {
    await crashAndWaitForThePage();
  }

  expect(await dialogsShown()).toBe(1);
});

test('remembers settings and window bounds across launches', async () => {
  const userData = join(E2E, 'relaunch');
  mkdirSync(userData, { recursive: true });
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ uiScale: 1.5, volume: 40, libraryFolder: MUSIC }));

  const first = await launch(userData);
  const firstPage = await first.firstWindow();
  await firstPage.getByRole('tab', { name: 'Albums' }).waitFor();

  // Already there when the first thing renders, with no wait: the window opens at the right size.
  const uiScale = await firstPage.evaluate(() => document.documentElement.style.getPropertyValue('--ui-scale'));
  expect(uiScale).toBe('1.5');
  const settings = await firstPage.evaluate(() => window.api.invoke('settings.get'));
  expect(settings).toMatchObject({ ok: true, value: { uiScale: 1.5, volume: 40 } });
  const bodyText = await firstPage.evaluate(() => Number.parseFloat(getComputedStyle(document.body).fontSize));
  expect(bodyText).toBe(21);

  await first.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setBounds({ x: 60, y: 70, width: 1000, height: 700 });
  });
  await first.close();
  const saved = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as Record<string, unknown>;
  expect(saved.windowBounds).toEqual({ x: 60, y: 70, width: 1000, height: 700, isMaximized: false });

  const second = await launch(userData);
  await second.firstWindow();
  const bounds = await second.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBounds());
  await second.close();
  expect(bounds).toEqual({ x: 60, y: 70, width: 1000, height: 700 });
});
