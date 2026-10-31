/*
 * The whole path through the UI on a generated library: onboarding, picking a folder, scanning, browsing, searching,
 * settings, and the screens that fix what goes wrong. The dialog and the shell are stubbed. Screenshots go to
 * .dev/screenshots/phase2/.
 */
import { cpSync, renameSync, rmSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import Database from 'better-sqlite3';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import type { ScanState, StorageInfo } from '@shared/domain';
import { captureRealWindow, launchApp, resizeWindow, ROOT, sendEvent, settled, stubFolderDialog } from './helpers/app';
import {
  generatedLibrary,
  LONG_ALBUM_TITLE,
  LONG_ARTIST_NAME,
  type GeneratedLibrary,
} from './helpers/generatedLibrary';

const E2E = join(ROOT, '.dev', 'e2e-browse');
const SCREENSHOTS = join(ROOT, '.dev', 'screenshots', 'phase2');
const PATHS = { userData: join(E2E, 'user-data'), dataRoot: join(E2E, 'data') };
const MUSIC = join(E2E, 'Music');

const SIZES = [
  [1280, 800],
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
  [900, 1200],
  [640, 480],
] as const;

let app: ElectronApplication;
let page: Page;
let library: GeneratedLibrary;
const problems: string[] = [];

async function start(): Promise<void> {
  app = await launchApp(PATHS);
  page = await app.firstWindow();
  page.on('console', (message) => {
    // Art that can't be had is a normal case with its own look. The browser logs it either way.
    if (message.type() === 'error' && !message.location().url.startsWith('art://')) {
      problems.push(`${test.info().title}: ${message.text()} ${message.location().url}`);
    }
  });
  page.on('pageerror', (error) => problems.push(error.message));
  await page.waitForLoadState('load');
}

async function waitForIdle(): Promise<void> {
  await expect
    .poll(
      async () => {
        const state = await page.evaluate(() => window.api.invoke('scan.state'));
        return state.ok ? state.value.phase : 'failed';
      },
      { timeout: 120_000 },
    )
    .toBe('idle');
}

async function capture(name: string): Promise<void> {
  for (const [width, height] of SIZES) {
    await resizeWindow(app, page, width, height);
    await page.screenshot({ path: join(SCREENSHOTS, `${name}-${width}x${height}.png`) });
  }
  await resizeWindow(app, page, 1280, 800);
}

function scroller() {
  return page.getByTestId('list-scroller');
}

function tab(name: string) {
  return page.getByRole('tab', { name, exact: true });
}

async function scrollTop(): Promise<number> {
  return scroller().evaluate((element) => element.scrollTop);
}

async function scrollListTo(top: number): Promise<void> {
  await scroller().evaluate((element, value) => {
    element.scrollTop = value;
  }, top);
  await settled(page);
}

async function album(title: string) {
  const card = page.getByTestId('album-card').filter({ hasText: title });
  await expect(card.first()).toBeVisible();
  return card.first();
}

/** Overscan keeps cards above the fold in the DOM, and Playwright would scroll the list to one of those to click it. */
async function cardOnScreen() {
  const cards = page.getByTestId('album-card');
  const index = await cards.evaluateAll((all) => {
    const list = document.querySelector('[data-testid="list-scroller"]')?.getBoundingClientRect();
    return all.findIndex((card) => {
      const { top, bottom } = card.getBoundingClientRect();
      return list !== undefined && top >= list.top && bottom <= list.bottom;
    });
  });
  expect(index).toBeGreaterThanOrEqual(0);
  return cards.nth(index);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(300_000);
  rmSync(E2E, { recursive: true, force: true });
  mkdirSync(SCREENSHOTS, { recursive: true });
  library = await generatedLibrary(MUSIC);
  await start();
  await resizeWindow(app, page, 1280, 800);
});

test.afterAll(async () => {
  await app.close();
});

test('with no folder, one calm screen and one button', async () => {
  await expect(page.getByRole('heading', { name: 'Point me at your music' })).toBeVisible();
  await expect(page.getByRole('button')).toHaveCount(1);
  await capture('onboarding');
});

test('cancelling the dialog stays where it was', async () => {
  await stubFolderDialog(app, null);
  await page.getByRole('button', { name: 'Choose a folder' }).click();
  await expect(page.getByRole('heading', { name: 'Point me at your music' })).toBeVisible();
});

test('pointing it at a folder scans with progress, and the list fills in', async () => {
  await stubFolderDialog(app, MUSIC);
  await page.getByRole('button', { name: 'Choose a folder' }).click();

  await expect(tab('Albums')).toBeVisible();
  await expect(page.getByTestId('scan-progress')).toBeVisible();
  await waitForIdle();
  await expect(page.getByTestId('scan-progress')).toBeHidden();
  await expect(page.getByTestId('album-card').first()).toBeVisible();
  await expect(
    page
      .getByRole('status')
      .or(page.getByText(/Scan finished/))
      .first(),
  ).toBeVisible();
});

test('the album grid has more lanes the more room it has, and they stay about the same size in fluid units', async () => {
  const lanes = async () =>
    page.getByTestId('album-card').evaluateAll((cards) => {
      const top = cards[0]?.getBoundingClientRect().top;
      return cards.filter((card) => card.getBoundingClientRect().top === top).length;
    });

  await resizeWindow(app, page, 1280, 800);
  expect(await lanes()).toBe(3);
  await resizeWindow(app, page, 1920, 1080);
  expect(await lanes()).toBe(4);
  await resizeWindow(app, page, 3840, 2160);
  expect(await lanes()).toBe(4);
  await resizeWindow(app, page, 1280, 800);
});

test('cards are real buttons, with art that loaded and no broken images', async () => {
  const card = page.getByTestId('album-card').first();
  expect(await card.evaluate((element) => element.tagName)).toBe('BUTTON');

  await settled(page);
  const images = await page.locator('img').evaluateAll((all) =>
    all.map((image) => ({
      loading: image.getAttribute('loading'),
      decoding: image.getAttribute('decoding'),
      src: image.getAttribute('src'),
      broken: (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth === 0,
    })),
  );
  expect(images.length).toBeGreaterThan(0);
  for (const image of images) {
    expect(image).toMatchObject({ loading: 'lazy', decoding: 'async', broken: false });
    expect(image.src).toMatch(/^art:\/\/thumb\/[0-9a-f]{40}$/);
  }
});

test('drilling into an album replaces the list, and Back restores the scroll position', async () => {
  await scrollListTo(1400);
  const before = await scrollTop();
  expect(before).toBeGreaterThan(1000);

  await (await cardOnScreen()).click();
  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
  await expect(page.locator('header h1')).toBeVisible();
  expect(await scrollTop()).toBe(0);

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('button', { name: 'Back' })).toBeHidden();
  await expect.poll(scrollTop).toBe(before);
});

test('Escape goes back as well, and a tab goes straight to its root', async () => {
  await scrollListTo(0);
  await page.getByTestId('album-card').first().click();
  await expect(page.locator('header h1')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('header h1')).toBeHidden();

  await page.getByTestId('album-card').first().click();
  await expect(page.locator('header h1')).toBeVisible();
  await tab('Albums').click();
  await expect(page.locator('header h1')).toBeHidden();
  await expect(page.getByTestId('album-card').first()).toBeVisible();
});

test('an album shows its header, numbers instead of art, and disc headings only when there are discs', async () => {
  await page.getByRole('searchbox').fill('Complete Recordings');
  await page.getByRole('button', { name: /^Complete Recordings Marble Arch/ }).click();

  const header = page.locator('header');
  await expect(header.getByRole('heading', { name: 'Complete Recordings' })).toBeVisible();
  await expect(header.getByRole('button', { name: 'Marble Arch' })).toBeVisible();
  await expect(header.getByText('2012 · 18 tracks')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Disc 1' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Disc 2' })).toBeVisible();

  const rows = page.getByTestId('list-row');
  await expect(rows.first()).toContainText('1');
  await expect(rows.first().locator('img')).toHaveCount(0);
  await capture('album');

  // From a one-disc album there's nothing to separate.
  await header.getByRole('button', { name: 'Marble Arch' }).click();
  await expect(page.locator('header').getByRole('heading', { name: 'Marble Arch' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tracks' })).toBeAttached();
  await expect(page.getByTestId('album-card').first()).toBeVisible();

  const oneDisc = page.getByTestId('album-card').filter({ hasNotText: 'Complete Recordings' }).first();
  await oneDisc.click();
  await expect(page.locator('header').getByRole('heading')).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Disc/ })).toHaveCount(0);

  await tab('Albums').click();
});

test('an album with no art gets a calm sleeve with its title, and long text stays inside its row', async () => {
  await page.getByRole('searchbox').fill('Bare Sleeve');
  await page.getByRole('button', { name: /^Bare Sleeve Tidewater/ }).click();
  const sleeve = page.locator('header [style*="--art-hue"]');
  await expect(sleeve).toBeVisible();
  await expect(sleeve).toContainText('Bare Sleeve');
  await expect(page.locator('header img')).toHaveCount(0);
  await tab('Albums').click();

  await page.getByRole('searchbox').fill('Extraordinarily');
  await page
    .getByRole('button', { name: new RegExp(`^${LONG_ALBUM_TITLE.slice(0, 20)}`) })
    .first()
    .click();
  const heading = page.locator('header h1');
  await expect(heading).toHaveText(LONG_ALBUM_TITLE);

  const rows = page.getByTestId('list-row');
  const overflow = await rows.evaluateAll((all) =>
    all.map((row) => {
      const { left, right } = row.getBoundingClientRect();
      const texts = [...row.querySelectorAll('span')].map((span) => span.getBoundingClientRect());
      return texts.every((box) => box.left >= left - 1 && box.right <= right + 1);
    }),
  );
  expect(overflow.every(Boolean)).toBe(true);

  await page.locator('header').getByRole('button', { name: LONG_ARTIST_NAME }).click();
  await expect(page.locator('header h1')).toHaveText(LONG_ARTIST_NAME);
  await tab('Albums').click();
});

test('artists and genres drill in', async () => {
  await tab('Artists').click();
  const artist = page.getByTestId('list-row').filter({ hasText: 'Björk' });
  await expect(artist).toContainText('1 album · 4 tracks');
  await artist.click();
  await expect(page.locator('header h1')).toHaveText('Björk');
  await expect(await album('Homogénic')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tracks' })).toBeVisible();

  await tab('Genres').click();
  const genre = page.getByTestId('list-row').filter({ hasText: 'J-Pop' });
  await expect(genre).toContainText('4');
  await genre.click();
  await expect(page.locator('header h1')).toHaveText('J-Pop');
  await expect(await album('大人 (アダルト)')).toBeVisible();

  await tab('Artists').click();
  await capture('artists');
  await tab('Albums').click();
  await capture('albums');
});

test('Tracks is virtual: only what is on screen is in the DOM, and more columns appear when there is room', async () => {
  await tab('Tracks').click();
  const rows = page.getByTestId('list-row');
  await expect(rows.first()).toBeVisible();

  const count = await rows.count();
  expect(count).toBeGreaterThan(5);
  expect(count).toBeLessThan(50);
  const total = await scroller().evaluate((element) => element.scrollHeight);
  const rowHeight = await rows.first().evaluate((element) => element.getBoundingClientRect().height);
  expect(Math.round(total / rowHeight)).toBeGreaterThanOrEqual(library.trackCount);

  const albumColumnWidth = () =>
    rows.first().evaluate((row) => {
      const year = [...row.querySelectorAll<HTMLElement>('.tabular-nums')].find((element) =>
        /^\d{4}$/.test(element.textContent),
      );
      return year ? year.getBoundingClientRect().width : 0;
    });

  await resizeWindow(app, page, 1280, 800);
  expect(await albumColumnWidth()).toBe(0);
  await resizeWindow(app, page, 1920, 1080);
  expect(await albumColumnWidth()).toBeGreaterThan(0);
  await resizeWindow(app, page, 1280, 800);

  await capture('tracks');
});

test('row heights follow the interface size and the window, and the same rows stay in view', async () => {
  await tab('Tracks').click();
  await scrollListTo(2000);
  const firstVisible = () =>
    page.getByTestId('list-row').evaluateAll((rows) => {
      const { top } = document.querySelector('[data-testid="list-scroller"]')?.getBoundingClientRect() ?? { top: 0 };
      const row = rows.find((candidate) => candidate.getBoundingClientRect().bottom > top);
      return row?.textContent;
    });
  const height = () =>
    page
      .getByTestId('list-row')
      .first()
      .evaluate((row) => row.getBoundingClientRect().height);

  const before = await firstVisible();
  const baseHeight = await height();

  await page.evaluate(() => window.api.invoke('settings.update', { uiScale: 1.5 }));
  await settled(page);
  expect(await height()).toBeCloseTo(baseHeight * 1.5, -1);
  await expect.poll(firstVisible).toBe(before);

  await page.evaluate(() => window.api.invoke('settings.update', { uiScale: 1 }));
  await settled(page);
  expect(await height()).toBeCloseTo(baseHeight, 0);

  await resizeWindow(app, page, 3840, 2160);
  expect(await height()).toBeGreaterThan(baseHeight * 1.8);
  await expect.poll(firstVisible).toBe(before);
  await resizeWindow(app, page, 1280, 800);
  await scrollListTo(0);
  await tab('Albums').click();
});

test('the keyboard gets one tab stop in a list, and the arrows move through it', async () => {
  await tab('Tracks').click();
  await expect(page.getByTestId('list-row').first()).toBeVisible();
  await tab('Tracks').focus();
  await page.keyboard.press('Tab');

  const focused = () =>
    page.evaluate(() => ({
      testId: document.activeElement?.getAttribute('data-testid'),
      index: document.activeElement?.closest('[data-index]')?.getAttribute('data-index'),
      ring: document.activeElement?.matches(':focus-visible'),
    }));
  expect(await focused()).toMatchObject({ testId: 'list-row', ring: true });
  const start = Number((await focused()).index);

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  expect(Number((await focused()).index)).toBe(start + 2);
  await page.keyboard.press('ArrowUp');
  expect(Number((await focused()).index)).toBe(start + 1);

  await page.keyboard.press('End');
  await expect.poll(async () => Number((await focused()).index)).toBe(library.trackCount - 1);
  await page.keyboard.press('Home');
  await expect.poll(async () => Number((await focused()).index)).toBe(0);

  // Tab leaves the list altogether instead of walking every row.
  await page.keyboard.press('Tab');
  expect((await focused()).testId).not.toBe('list-row');

  // The grid moves in two directions, and Back returns focus to the card that was opened.
  await tab('Albums').click();
  await expect(page.getByTestId('album-card').first()).toBeVisible();
  await tab('Albums').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  const position = await page.evaluate(() => ({
    index: document.activeElement?.closest('[data-index]')?.getAttribute('data-index'),
    title: document.activeElement?.textContent,
  }));
  expect(position.index).toBe('1');
  await page.keyboard.press('Enter');
  await expect(page.locator('header h1')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => document.activeElement?.textContent)).toBe(position.title);
});

test('search replaces the list, and leaves it where it was', async () => {
  await tab('Albums').click();
  await scrollListTo(900);
  const before = await scrollTop();

  const field = page.getByRole('searchbox');
  await field.fill('harbour');
  await expect(page.getByRole('heading', { name: 'Artists' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Albums' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tracks' })).toBeVisible();
  await expect(page.getByRole('tab', { selected: true })).toHaveCount(0);
  await capture('search');

  await field.press('Escape');
  await expect(field).toHaveValue('');
  await expect(tab('Albums')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(scrollTop).toBe(before);

  await field.fill('zzzzzz');
  await expect(page.getByText('Nothing matches “zzzzzz”')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).first().click();
  await expect(field).toHaveValue('');
  await expect(page.getByTestId('album-card').first()).toBeVisible();

  await scrollListTo(0);
});

test('opening a result drills in, and Back returns to the results', async () => {
  const field = page.getByRole('searchbox');
  await field.fill('homog');
  await page.getByRole('button', { name: /^Homogénic Björk/ }).click();
  await expect(page.locator('header h1')).toHaveText('Homogénic');
  await expect(field).toHaveValue('');

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(field).toHaveValue('homog');
  await expect(page.getByRole('button', { name: /^Homogénic Björk/ })).toBeVisible();

  // A track goes to its album from its menu, since pressing it is for playing it.
  await page.getByRole('searchbox').fill('jóga');
  await page.getByTestId('list-row').filter({ hasText: 'Jóga' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Go to album' }).click();
  await expect(page.locator('header h1')).toHaveText('Homogénic');
  await tab('Albums').click();
});

test('search is deaf to diacritics, and to punctuation that would break a query', async () => {
  const field = page.getByRole('searchbox');
  await field.fill('bjork');
  await expect(page.getByTestId('list-row').filter({ hasText: 'Björk' }).first()).toBeVisible();
  await field.fill('"*(');
  await expect(page.getByText(/Nothing matches/)).toBeVisible();
  await field.fill('');
});

test('settings shows the real numbers', async () => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByTestId('settings');
  await expect(settings).toBeVisible();

  const result = await page.evaluate(() => window.api.invoke('system.storageInfo'));
  if (!result.ok) throw new Error(result.error.message);
  const storage: StorageInfo = result.value;
  expect(storage.counts.tracks).toBe(library.trackCount);

  const section = (name: string) => settings.getByRole('region', { name });

  await expect(section('Library')).toContainText(MUSIC);
  await expect(section('Storage')).toContainText(storage.counts.tracks.toLocaleString('en'));
  await expect(section('Storage')).toContainText(storage.counts.albums.toLocaleString('en'));
  await expect(section('Storage')).toContainText(storage.databasePath ?? 'no database');
  await expect(section('Storage')).toContainText(storage.cachePath);
  await expect(section('Storage')).toContainText(storage.logsPath);
  await expect(section('Storage')).toContainText(storage.thisMachine);
  await expect(section('Storage')).toContainText(`On ${storage.thisMachine} at`);
  await expect(section('Storage')).toContainText(storage.engine.mpvPath);
  await expect(section('Storage')).toContainText(storage.engine.mpvVersion ?? 'no mpv');
  await expect(section('Storage')).toContainText(storage.engine.ffmpegPath);
  await expect(section('Storage')).toContainText(storage.engine.ffmpegVersion ?? 'no ffmpeg');

  await expect(page.getByTestId('scan-report')).toContainText('added');
  await expect(page.getByTestId('scan-issues')).toContainText('1 file · Tags are missing or damaged');
  await page.getByRole('button', { name: 'Show the files' }).click();
  await expect(page.getByTestId('scan-issues')).toContainText('Broken\\corrupt.flac');
  await expect(page.getByTestId('scan-issues')).toContainText('Untagged\\an untagged file.flac');

  await capture('settings');
});

test('every Reveal goes through main', async () => {
  await app.evaluate(({ shell }) => {
    const calls: string[] = [];
    Object.assign(globalThis, { revealCalls: calls });
    shell.showItemInFolder = (path) => {
      calls.push(`show:${path}`);
    };
    shell.openPath = (path) => {
      calls.push(`open:${path}`);
      return Promise.resolve('');
    };
  });

  const reveal = async (name: string) => {
    await page.getByRole('button', { name, exact: true }).click();
    await expect
      .poll(() => app.evaluate(() => (globalThis as unknown as { revealCalls: string[] }).revealCalls.length))
      .toBeGreaterThan(0);
    const calls = await app.evaluate(() => (globalThis as unknown as { revealCalls: string[] }).revealCalls.splice(0));
    return calls[0] ?? '';
  };

  expect(await reveal('Reveal the library folder')).toBe(`open:${MUSIC}`);
  expect(await reveal('Reveal the database')).toMatch(/^show:.*library\.db$/);
  expect(await reveal('Reveal the art cache')).toBe(`open:${join(PATHS.userData, 'art-cache')}`);
  expect(await reveal('Reveal the settings file')).toBe(`show:${join(PATHS.userData, 'settings.json')}`);
  expect(await reveal('Reveal log')).toBe(`open:${join(PATHS.userData, 'logs')}`);
});

test('the interface-size slider changes the size of everything, and stays saved', async () => {
  const slider = page.getByRole('slider', { name: 'Interface size' });
  await slider.scrollIntoViewIfNeeded();
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--ui-scale')))
    .toBe('1.05');
  const saved = await page.evaluate(() => window.api.invoke('settings.get'));
  expect(saved).toMatchObject({ ok: true, value: { uiScale: 1.05 } });

  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--ui-scale'))).toBe('1');
});

test('the slider stays on screen whatever it does to the size of everything', async () => {
  const thumbIsInView = () =>
    page.getByRole('slider', { name: 'Interface size' }).evaluate((thumb) => {
      const settings = document.querySelector('[data-testid="settings"]')?.getBoundingClientRect();
      const { top, bottom } = thumb.getBoundingClientRect();
      return settings !== undefined && top >= settings.top && bottom <= settings.bottom;
    });

  for (const [width, height] of [
    [1280, 800],
    [1920, 1080],
  ] as const) {
    await resizeWindow(app, page, width, height);
    const slider = page.getByRole('slider', { name: 'Interface size' });
    await slider.focus();
    for (let step = 0; step < 6; step++) {
      await page.keyboard.press('ArrowRight');
      await settled(page);
      expect(await thumbIsInView()).toBe(true);
    }
    await page.keyboard.press('End');
    await settled(page);
    expect(await thumbIsInView()).toBe(true);
    await page.keyboard.press('Home');
    await settled(page);
    expect(await thumbIsInView()).toBe(true);
  }

  // A drag leaves the size alone until it ends, so the thumb stays under the pointer.
  const before = await page.evaluate(() => document.documentElement.style.getPropertyValue('--ui-scale'));
  const box = await page.getByRole('slider', { name: 'Interface size' }).boundingBox();
  if (!box) throw new Error('The slider has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + box.height / 2);
  await settled(page);
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--ui-scale'))).toBe(before);
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--ui-scale')))
    .not.toBe(before);
  await settled(page);
  expect(await thumbIsInView()).toBe(true);

  await page.evaluate(() => window.api.invoke('settings.update', { uiScale: 1 }));
  await resizeWindow(app, page, 1280, 800);
  await settled(page);
});

test('the back control and the gear both leave settings', async () => {
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByTestId('settings')).toBeHidden();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByTestId('settings')).toBeHidden();
});

test('a missing file can be seen, and removed only after a warning', async () => {
  rmSync(join(MUSIC, 'Björk', 'Homogénic', '1-02 Hunter.flac'));
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Rescan' }).click();
  await waitForIdle();

  const section = page.getByTestId('settings').getByRole('region', { name: 'Missing' });
  await expect(section).toContainText('1 track in the library');

  await section.getByRole('button', { name: 'Show them' }).click();
  await expect(page.locator('header h1')).toHaveText('Missing tracks');
  await expect(page.getByTestId('list-row')).toContainText('Hunter');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByTestId('settings')).toBeVisible();

  await section.getByRole('button', { name: 'Remove missing' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('playlist');
  await dialog.getByRole('button', { name: 'Keep them' }).click();
  await expect(section).toContainText('1 track in the library');

  await section.getByRole('button', { name: 'Remove missing' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove them' }).click();
  await expect(section).toContainText('Everything in the library is on this device');
  await page.getByRole('button', { name: 'Back' }).click();
});

test('a scan shows its progress in plain words, can be cancelled, and leaves the list alone', async () => {
  const reading: ScanState = {
    phase: 'reading',
    filesFound: 5719,
    filesDone: 1204,
    currentPath: null,
    lastReport: null,
  };
  // The toasts from the tests before would cover what these screenshots are for.
  const dismiss = page.getByRole('button', { name: 'Dismiss' });
  while ((await dismiss.count()) > 0) {
    // One can time out by itself between the count and the click.
    await dismiss
      .first()
      .click({ timeout: 1_000 })
      .catch(() => {});
  }

  await sendEvent(app, 'scan.state', reading);
  const progress = page.getByTestId('scan-progress');
  await expect(progress).toContainText('Reading tags');
  await expect(progress).toContainText('1,204 of 5,719');
  await capture('scanning');

  for (const [phase, words] of [
    ['walking', 'Looking for music'],
    ['hashing', 'Checking the audio'],
    ['writing', 'Saving'],
    ['art', 'Preparing album art'],
  ] as const) {
    await sendEvent(app, 'scan.state', { ...reading, phase });
    await expect(progress).toContainText(words);
  }

  await sendEvent(app, 'scan.state', { ...reading, phase: 'idle' });
  await expect(progress).toBeHidden();

  await page.evaluate(() => window.api.invoke('scan.start'));
  await page
    .getByRole('button', { name: 'Cancel' })
    .click({ timeout: 5_000 })
    .catch(() => {});
  await waitForIdle();
});

test('the list stays put while new music arrives, with no skeletons flashing', async () => {
  await tab('Tracks').click();
  await scrollListTo(1500);
  const before = await scrollTop();

  await page.evaluate(() => {
    const seen = { skeletons: 0 };
    Object.assign(window, { skeletonWatch: seen });
    new MutationObserver(() => {
      if (document.querySelector('.animate-skeleton')) seen.skeletons++;
    }).observe(document.body, { childList: true, subtree: true });
  });

  for (let round = 0; round < 3; round++) {
    await sendEvent(app, 'library.changed', { scopes: ['library'] });
    await page.waitForTimeout(150);
  }
  expect(await scrollTop()).toBe(before);

  // And for real: new files turn up in a rescan, and the list grows around where it was.
  const heightBefore = await scroller().evaluate((element) => element.scrollHeight);
  cpSync(join(MUSIC, 'Björk', 'Homogénic'), join(MUSIC, 'Björk', 'Homogénic again'), { recursive: true });
  await page.evaluate(() => window.api.invoke('scan.start'));
  await waitForIdle();
  await expect.poll(() => scroller().evaluate((element) => element.scrollHeight)).toBeGreaterThan(heightBefore);

  expect(await scrollTop()).toBe(before);
  expect(
    await page.evaluate(() => (window as unknown as { skeletonWatch: { skeletons: number } }).skeletonWatch),
  ).toEqual({
    skeletons: 0,
  });
  await scrollListTo(0);
  await tab('Albums').click();
});

test('notices become toasts, and their actions work', async () => {
  await sendEvent(app, 'notice', {
    id: 9001,
    level: 'info',
    message: 'Three files had problems',
    action: { kind: 'open-storage', label: 'See issues' },
  });
  await page.getByRole('button', { name: 'See issues' }).first().click();
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
});

test('toasts sit bottom left over the art in both layouts, and leave what is under them usable', async () => {
  await sendEvent(app, 'notice', { id: 9002, level: 'warning', message: 'Over the art', action: null });
  const toast = page.locator('[data-toast]', { hasText: 'Over the art' });
  await expect(toast).toBeVisible();

  for (const [width, height] of [
    [1280, 800],
    [800, 1100],
  ] as const) {
    await resizeWindow(app, page, width, height);
    const art = await page.getByTestId('art').boundingBox();
    const box = await toast.boundingBox();
    if (!art || !box) throw new Error('No box');
    const gutter = 40;
    expect(box.x).toBeGreaterThanOrEqual(art.x);
    expect(box.x - art.x).toBeLessThan(gutter);
    expect(box.x + box.width).toBeLessThanOrEqual(art.x + art.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(art.y + art.height + 1);
    expect(art.y + art.height - (box.y + box.height)).toBeLessThan(gutter);
  }
  await resizeWindow(app, page, 1280, 800);

  const box = await toast.boundingBox();
  if (!box) throw new Error('No box');
  const hitsToast = ([x, y]: readonly [number, number]) => !!document.elementFromPoint(x, y)?.closest('[data-toast]');
  const body = [box.x + box.width / 3, box.y + box.height / 2] as const;
  expect(await page.evaluate(hitsToast, body)).toBe(true);
  await page.getByRole('button', { name: 'Equalizer' }).first().click();
  await expect(page.getByTestId('equalizer')).toBeVisible();
  expect(await page.evaluate(hitsToast, body)).toBe(false);
  // Its own buttons still work.
  await toast.getByRole('button', { name: 'Dismiss' }).click();
  await expect(toast).toBeHidden();
  await page.getByRole('button', { name: 'Close equalizer' }).click();
});

test('the window controls have the room they need, in a real window', async () => {
  for (const [width, height] of [
    [1280, 800],
    [1920, 1080],
    [3840, 2160],
    [900, 1200],
    [640, 480],
  ] as const) {
    await resizeWindow(app, page, width, height);
    const room = await page.evaluate(() => {
      // TypeScript's DOM types don't have the Window Controls Overlay API yet.
      const overlay = (navigator as Navigator & { windowControlsOverlay: { getTitlebarAreaRect(): DOMRect } })
        .windowControlsOverlay;
      const area = overlay.getTitlebarAreaRect();
      const gear = document.querySelector('[aria-label="Settings"]')?.getBoundingClientRect();
      return {
        areaRight: area.x + area.width,
        areaHeight: area.height,
        gearRight: gear?.right ?? 0,
        gearTop: gear?.top ?? 0,
      };
    });
    // Beside the art the gear stops short of the controls. Stacked, it's below them.
    expect(room.gearRight <= room.areaRight || room.gearTop >= room.areaHeight, JSON.stringify({ width, room })).toBe(
      true,
    );
    writeFileSync(join(SCREENSHOTS, `real-window-${width}x${height}.png`), await captureRealWindow(app));
  }
  await resizeWindow(app, page, 1280, 800);
});

test('the search field and the gear are not part of the drag region, and the strip around them is', async () => {
  const regions = await page.evaluate(() => {
    const appRegion = (element: Element | null) =>
      element ? getComputedStyle(element).getPropertyValue('app-region') : null;
    return {
      header: appRegion(document.querySelector('[data-testid="list-header"]')),
      search: appRegion(document.querySelector('[data-testid="list-header"] label')),
      gear: appRegion(document.querySelector('[aria-label="Settings"]')),
    };
  });
  expect(regions).toEqual({ header: 'drag', search: 'no-drag', gear: 'no-drag' });
});

test('an empty folder says so, with the way out', async () => {
  const empty = join(E2E, 'Empty');
  mkdirSync(empty, { recursive: true });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await stubFolderDialog(app, empty);
  await page.getByRole('button', { name: 'Change folder' }).click();

  await expect(page.getByText('No music found in this folder')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Rescan' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change folder' })).toBeVisible();
  await page.screenshot({ path: join(SCREENSHOTS, 'empty-folder-1280x800.png') });

  await tab('Playlists').click();
  await expect(page.getByText('No playlists yet')).toBeVisible();
  await tab('Queue').click();
  await expect(page.getByText('Nothing queued')).toBeVisible();
  await tab('Albums').click();

  await stubFolderDialog(app, MUSIC);
  await page.getByRole('button', { name: 'Change folder' }).click();
  await expect(page.getByTestId('album-card').first()).toBeVisible();
  await waitForIdle();
});

test('the folder disappearing gets a plain screen, and Retry brings it back', async () => {
  const away = join(E2E, 'Music-away');
  // Windows won't rename a folder while a worker has a file in it open, and the art pass can still be finishing.
  await expect
    .poll(
      () => {
        try {
          renameSync(MUSIC, away);
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 30_000 },
    )
    .toBe(true);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Rescan' }).click();

  await expect(page.getByRole('heading', { name: "Can't find your music" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(MUSIC)).toBeVisible();
  await page.screenshot({ path: join(SCREENSHOTS, 'folder-missing-1280x800.png') });

  // Still gone: the screen stays, and says it tried.
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText("That folder still isn't there")).toBeVisible();
  await expect(page.getByRole('heading', { name: "Can't find your music" })).toBeVisible();

  renameSync(away, MUSIC);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(tab('Albums')).toBeVisible();
  await expect(page.getByRole('heading', { name: "Can't find your music" })).toBeHidden();
  await waitForIdle();
});

test('a library last changed on another machine says so, once', async () => {
  const result = await page.evaluate(() => window.api.invoke('system.storageInfo'));
  if (!result.ok) throw new Error(result.error.message);
  const { databasePath } = result.value;
  await app.close();

  const db = new Database(databasePath ?? '');
  db.prepare("UPDATE library_meta SET value = 'THE-MAIN-MACHINE' WHERE key = 'last_changed_host'").run();
  db.close();

  await start();
  expect(hostname()).not.toBe('THE-MAIN-MACHINE');
  const notice = page.getByText(/Library last changed on THE-MAIN-MACHINE/);
  await expect(notice.first()).toBeVisible();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByTestId('settings').getByRole('region', { name: 'Storage' })).toContainText(
    'On THE-MAIN-MACHINE at',
  );
  await expect(page.getByTestId('scan-report')).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
});

test('a damaged database gets its screen, with a warning before anything is lost', async () => {
  const result = await page.evaluate(() => window.api.invoke('system.storageInfo'));
  if (!result.ok) throw new Error(result.error.message);
  const databasePath = result.value.databasePath ?? '';
  await app.close();

  writeFileSync(databasePath, 'garbage '.repeat(2000));
  await start();

  await expect(page.getByRole('heading', { name: "The library's database can't be opened" })).toBeVisible();
  await page.screenshot({ path: join(SCREENSHOTS, 'db-corrupt-1280x800.png') });

  await page.getByRole('button', { name: 'Rebuild the library' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Playlists');
  await page.screenshot({ path: join(SCREENSHOTS, 'db-corrupt-rebuild-1280x800.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Keep it as it is' }).click();
  await expect(dialog).toBeHidden();
  expect(existsSync(databasePath)).toBe(true);

  await page.getByRole('button', { name: 'Restore the backup' }).click();
  await expect(tab('Albums')).toBeVisible();
  await expect(page.getByTestId('album-card').first()).toBeVisible();
});

test('nothing logged an error along the way', () => {
  expect(problems).toEqual([]);
});
