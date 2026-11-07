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
import {
  captureRealWindow,
  closeSettings,
  launchApp,
  openSettingsTab,
  resizeWindow,
  ROOT,
  sendEvent,
  settled,
  stubFolderDialog,
} from './helpers/app';
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

/** A line beside the tabs and between the sections, and nothing clickable in the panes that looks like plain text. */
async function expectModalReadable(name: string): Promise<void> {
  const dialog = page.getByTestId('settings');
  await settled(page);
  const seen = await dialog.evaluate((element) => {
    const pane = element.querySelector('[role="tabpanel"]:not([hidden])');
    const sections = [...(pane?.querySelectorAll('section section') ?? [])];
    const ghosts = [...(pane?.querySelectorAll('button:not([role="switch"], [role="radio"])') ?? [])].filter(
      (button) => {
        const { backgroundColor, borderTopWidth } = getComputedStyle(button);
        // Words with nothing around them read as text, not a button. An icon, such as a stepper's, is clearly one, and so
        // is a row across the pane, like a list's.
        const hasWords = (button.textContent ?? '').trim() !== '';
        const isRow = button.getBoundingClientRect().width > (pane?.getBoundingClientRect().width ?? 0) / 2;
        return hasWords && !isRow && backgroundColor === 'rgba(0, 0, 0, 0)' && parseFloat(borderTopWidth) === 0;
      },
    );
    return {
      sections: sections.length,
      // A section after another one starts with its line.
      divided: sections.every((section) => {
        if (section.previousElementSibling?.tagName !== 'SECTION') return true;
        const line = section.firstElementChild;
        return line !== null && getComputedStyle(line).display !== 'none' && line.getBoundingClientRect().height > 0;
      }),
      ghosts: ghosts.map((button) => button.textContent),
    };
  });
  expect(seen.divided).toBe(true);
  expect(seen.ghosts).toEqual([]);
  mkdirSync(join(ROOT, '.dev', 'screenshots', 'modals'), { recursive: true });
  await page.screenshot({ path: join(ROOT, '.dev', 'screenshots', 'modals', `settings-${name}-1280x800.png`) });
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

  await expect(page.getByRole('tab')).toHaveText(['Genres', 'Artists', 'Albums', 'Tracks', 'Playlists']);
  await expect(tab('Albums')).toHaveAttribute('aria-selected', 'true');
  await tab('Albums').click();
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

test('everything clickable has the pointer, and what is disabled does not', async () => {
  const cursor = (of: ReturnType<Page['locator']>) => of.evaluate((element) => getComputedStyle(element).cursor);
  expect(await cursor(page.getByTestId('album-card').first())).toBe('pointer');
  expect(await cursor(page.getByTestId('album-card').first().locator('img, span').first())).toBe('pointer');
  expect(await cursor(tab('Tracks'))).toBe('pointer');
  expect(await cursor(page.getByRole('button', { name: 'Settings', exact: true }))).toBe('pointer');
  expect(await cursor(page.getByRole('button', { name: 'Next' }))).toBe('default');
  expect(await cursor(page.locator('body'))).toBe('default');

  // A slider is a pointer along its whole line. The main screen has no switches any more: its toggles are icons.
  expect(
    await cursor(page.getByRole('slider', { name: 'Volume' }).locator('xpath=ancestor::*[@data-orientation][last()]')),
  ).toBe('pointer');

  await tab('Tracks').click();
  expect(await cursor(page.getByTestId('list-row').first())).toBe('pointer');
  await tab('Albums').click();
  await expect(page.getByTestId('album-card').first()).toBeVisible();
});

test('a card shows hover on its surface and leaves the art alone', async () => {
  const card = page.getByTestId('album-card').first();
  const surface = () => card.evaluate((element) => getComputedStyle(element, '::before').backgroundColor);
  const box = await card.boundingBox();
  await page.mouse.move(box!.x - 40, box!.y - 80);
  const before = await surface();

  await card.hover();
  await expect.poll(surface).not.toBe(before);
  const rowHover = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.background = 'var(--surface-hover)';
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
  await expect.poll(surface).toBe(rowHover);
  expect(
    await card
      .locator('img')
      .first()
      .evaluate((image) => {
        const filters = [image, image.parentElement!].map((element) => getComputedStyle(element).filter);
        return filters.every((filter) => filter === 'none');
      }),
  ).toBe(true);
  await page.screenshot({ path: join(SCREENSHOTS, 'card-hover-1280x800.png') });
  await page.mouse.move(0, 0);
});

test('a scrollbar is thin unless a finger may need it, and rows are as wide either way', async () => {
  const sizes = await scroller().evaluate((element: HTMLElement) => {
    const probeWidth = (width: string) => {
      const box = document.createElement('div');
      box.style.width = width;
      box.style.height = '0';
      document.body.append(box);
      const measured = box.getBoundingClientRect().width;
      box.remove();
      return measured;
    };
    const probe = document.createElement('div');
    probe.style.width = 'calc(var(--scrollbar-width) + var(--spacing-gutter) * 2)';
    probe.style.height = '0';
    const room = document.createElement('div');
    room.style.width = 'calc(var(--spacing) * 2 + var(--spacing-cell) * 3)';
    room.style.height = '0';
    document.body.append(probe, room);
    const measured = {
      bar: element.offsetWidth - element.clientWidth,
      spacing: probeWidth('var(--spacing)'),
      isCoarse: matchMedia('(any-pointer: coarse)').matches,
      gutters: probe.getBoundingClientRect().width,
      old: room.getBoundingClientRect().width,
    };
    probe.remove();
    room.remove();
    return measured;
  });
  expect(Math.abs(sizes.bar - sizes.spacing * (sizes.isCoarse ? 3.5 : 1.25))).toBeLessThan(1);
  expect(sizes.gutters).toBeCloseTo(sizes.old, 1);
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
  await expect(page.getByTestId('album-card')).toHaveCount(0);
  await page
    .getByRole('main')
    .getByRole('button', { name: /東京事変/ })
    .first()
    .click();
  await expect(page.locator('header h1')).toHaveText('東京事変');
  await (await album('大人 (アダルト)')).click();
  await expect(page.locator('header h1')).toHaveText('大人 (アダルト)');
  await expect(page.getByTestId('list-row').first()).toBeVisible();

  const back = page.getByRole('button', { name: 'Back' });
  await back.click();
  await expect(page.locator('header h1')).toHaveText('東京事変');
  await back.click();
  await expect(page.locator('header h1')).toHaveText('J-Pop');
  await back.click();
  await expect(back).toBeHidden();
  await expect(tab('Genres')).toHaveAttribute('aria-selected', 'true');
  await expect(genre).toBeVisible();

  // From the Artists tab there's one step less, and the place in the list is still there on the way back.
  // A short window, so the list scrolls further than a row: a place is kept by row.
  await resizeWindow(app, page, 1024, 600);
  await tab('Artists').click();
  // Settled first: a list still arriving puts back its remembered place over any scroll made meanwhile.
  await settled(page);
  await scrollListTo(200);
  const scrolled = await scrollTop();
  expect(scrolled).toBeGreaterThan(60);
  // The row nearest the middle, so Playwright has no reason to scroll to it, which would move the place being kept.
  const onScreen = await scroller().evaluate((list) => {
    const box = list.getBoundingClientRect();
    const middle = (box.top + box.bottom) / 2;
    const rows = [...list.querySelectorAll('[data-testid="list-row"]')].map((row) => {
      const { top, bottom } = row.getBoundingClientRect();
      return Math.abs((top + bottom) / 2 - middle);
    });
    return rows.indexOf(Math.min(...rows));
  });
  expect(onScreen).toBeGreaterThanOrEqual(0);
  await page.getByTestId('list-row').nth(onScreen).click();
  await expect(page.locator('header h1')).toBeVisible();
  await back.click();
  await expect(back).toBeHidden();
  await expect.poll(scrollTop).toBe(scrolled);
  await resizeWindow(app, page, 1280, 800);

  await tab('Artists').click();
  await capture('artists');
  await tab('Albums').click();
  await capture('albums');
});

test('Tracks is virtual, and grouped like foobar2000: a heading for each album, then one tight line per track', async () => {
  await tab('Tracks').click();
  const rows = page.getByTestId('list-row');
  await expect(rows.first()).toBeVisible();

  const count = await rows.count();
  expect(count).toBeGreaterThan(5);
  expect(count).toBeLessThan(50);
  const total = await scroller().evaluate((element) => element.scrollHeight);
  const rowHeight = await rows.first().evaluate((element) => element.getBoundingClientRect().height);
  expect(Math.round(total / rowHeight)).toBeGreaterThanOrEqual(library.trackCount);

  await expect(scroller().getByRole('heading', { level: 2 }).first()).toContainText(' - ');
  // Under the tap floor on purpose, and with no art: the heading says the album.
  expect(rowHeight).toBeLessThan(44);
  expect(await rows.first().getByRole('img').count()).toBe(0);

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
  // The search beside the tabs is the stop before the list.
  await page.getByRole('searchbox', { name: 'Search your library' }).focus();
  await page.keyboard.press('Tab');

  const focused = () =>
    page.evaluate(() => ({
      testId: document.activeElement?.getAttribute('data-testid'),
      index: document.activeElement?.closest('[data-index]')?.getAttribute('data-index'),
      ring: document.activeElement?.matches(':focus-visible'),
    }));
  expect(await focused()).toMatchObject({ testId: 'list-row', ring: true });
  const start = Number((await focused()).index);

  // Album headings take places in the list too, and the arrows step over them.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  const twoDown = Number((await focused()).index);
  expect(twoDown).toBeGreaterThanOrEqual(start + 2);
  await page.keyboard.press('ArrowUp');
  const oneUp = Number((await focused()).index);
  expect(oneUp).toBeGreaterThan(start);
  expect(oneUp).toBeLessThan(twoDown);

  const isLast = () =>
    page.evaluate(() => {
      const shown = [...document.querySelectorAll('[data-index]')].map((row) => Number(row.getAttribute('data-index')));
      const at = document.activeElement?.closest('[data-index]')?.getAttribute('data-index');
      return at !== undefined && at !== null && Number(at) === Math.max(...shown);
    });
  await page.keyboard.press('End');
  await expect.poll(isLast).toBe(true);
  await page.keyboard.press('Home');
  // The first album's heading is place 0.
  await expect.poll(async () => Number((await focused()).index)).toBe(1);

  // Tab leaves the list altogether instead of walking every row.
  await page.keyboard.press('Tab');
  expect((await focused()).testId).not.toBe('list-row');

  // The grid moves in two directions, and Back returns focus to the card that was opened.
  await tab('Albums').click();
  await expect(page.getByTestId('album-card').first()).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search your library' }).focus();
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
  // Library has the folder, the report and what's on disk.
  await openSettingsTab(page, 'Library');
  const settings = page.getByTestId('settings');
  await expect(settings).toBeVisible();

  const result = await page.evaluate(() => window.api.invoke('system.storageInfo'));
  if (!result.ok) throw new Error(result.error.message);
  const storage: StorageInfo = result.value;
  expect(storage.counts.tracks).toBe(library.trackCount);

  const section = (name: string) => settings.getByRole('region', { name, exact: true });

  const report = page.getByTestId('library-report');
  await expect(report).toContainText(storage.counts.tracks.toLocaleString('en'));
  await expect(report).toContainText(storage.counts.albums.toLocaleString('en'));
  await expect(section('Storage')).toContainText(storage.databasePath ?? 'no database');
  await expect(section('Storage')).toContainText(storage.cachePath);
  await expect(section('Storage')).toContainText(storage.logsPath);
  await expect(section('Storage')).toContainText(storage.thisMachine);
  await expect(section('Storage')).toContainText(`On ${storage.thisMachine} at`);
  await expect(section('Storage')).toContainText(storage.engine.mpvPath);
  await expect(section('Storage')).toContainText(storage.engine.mpvVersion ?? 'no mpv');
  await expect(section('Storage')).toContainText(storage.engine.ffmpegPath);
  await expect(section('Storage')).toContainText(storage.engine.ffmpegVersion ?? 'no ffmpeg');

  for (const other of ['General', 'Seasons', 'Online and data', 'Stats']) {
    await openSettingsTab(page, other);
    await expectModalReadable(other.toLowerCase().replaceAll(' ', '-'));
  }
  await openSettingsTab(page, 'Library');
  await expectModalReadable('library');
  await expect(section('Library')).toContainText(MUSIC);
  await expect(page.getByTestId('scan-report')).toContainText('added');
  // A file the scan couldn't read is a scan issue. One with no tags still plays, so the report has it under Tags.
  await settings.getByRole('button', { name: /^Scan issues/ }).click();
  await expect(settings).toContainText('Broken\\corrupt.flac');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await settings.getByRole('button', { name: /^Title is the file name/ }).click();
  await expect(settings).toContainText('an untagged file');
  await page.getByRole('button', { name: 'Back', exact: true }).click();

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
  expect(await reveal('Reveal your data')).toMatch(/^show:.*library\.db$/);
  expect(await reveal('Reveal the art cache')).toBe(`open:${join(PATHS.userData, 'art-cache')}`);
  expect(await reveal("Reveal this PC's settings")).toBe(`show:${join(PATHS.userData, 'settings.json')}`);
  expect(await reveal('Reveal the logs')).toBe(`open:${join(PATHS.userData, 'logs')}`);
});

test('the interface-size slider changes the size of everything, and stays saved', async () => {
  await openSettingsTab(page, 'General');
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

test('settings is a page: Ctrl+, opens it, the arrows go through its tabs, and Escape goes back', async () => {
  const gear = page.getByRole('button', { name: 'Settings', exact: true });
  const settings = page.getByTestId('settings');
  await closeSettings(page);
  await expect(settings).toBeHidden();
  await expect(tab('Albums')).toBeVisible();

  await gear.click();
  await expect(settings).toBeVisible();
  const general = settings.getByRole('tab', { name: 'General' });
  await general.click();
  await general.focus();
  await page.keyboard.press('ArrowDown');
  await expect(settings.getByRole('tab', { name: 'Library' })).toHaveAttribute('aria-selected', 'true');
  await expect(settings.getByRole('region', { name: 'Library', exact: true })).toBeVisible();
  await page.keyboard.press('ArrowUp');
  await expect(general).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(tab('Albums')).toBeVisible();

  await page.keyboard.press('Control+,');
  await expect(settings).toBeVisible();
  await expect(general).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
});

test('settings fits every window, with the tabs beside it or along the top', async () => {
  const settings = page.getByTestId('settings');
  await page.keyboard.press('Control+,');
  await expect(settings).toBeVisible();
  const generalTab = settings.getByRole('tab', { name: 'General' });
  const libraryTab = settings.getByRole('tab', { name: 'Library' });
  const titleBarHeight = () =>
    page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.querySelector('[data-testid="title-bar"]') as Element).height),
    );

  // Null where either is fine: it goes by the page's own width in em, which the type decides.
  for (const [width, height, isBeside] of [
    [1280, 800, true],
    [1920, 1080, true],
    [3840, 2160, true],
    [900, 1200, null],
    [640, 480, false],
    [640, 900, null],
  ] as const) {
    await resizeWindow(app, page, width, height);
    const box = await settings.boundingBox();
    if (!box) throw new Error('No box');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y + box.height).toBeLessThanOrEqual(height);

    const first = await generalTab.boundingBox();
    const second = await libraryTab.boundingBox();
    if (!first || !second) throw new Error('No tabs');
    const beside = second.y > first.y;
    if (isBeside !== null) expect(beside).toBe(isBeside);
    if (!beside) expect(second.x).toBeGreaterThan(first.x);
    // Clear of the window controls, which take any press under them.
    expect(first.y).toBeGreaterThanOrEqual(await titleBarHeight());
    if (width === 640 && height === 480) await page.screenshot({ path: join(SCREENSHOTS, 'settings-640x480.png') });
  }
  await openSettingsTab(page, 'Library');
  await resizeWindow(app, page, 1920, 1080);
  await settled(page);
  await page.screenshot({ path: join(SCREENSHOTS, 'settings-1920x1080.png') });
  await resizeWindow(app, page, 1280, 800);
  await settled(page);
  await page.screenshot({ path: join(SCREENSHOTS, 'settings-1280x800.png') });
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
});

test('a missing file can be seen, and removed only after a warning', async () => {
  rmSync(join(MUSIC, 'Björk', 'Homogénic', '1-02 Hunter.flac'));
  await openSettingsTab(page, 'Library');
  await page.getByRole('button', { name: 'Rescan' }).click();
  await waitForIdle();

  const section = page.getByTestId('settings').getByRole('region', { name: 'Missing' });
  await expect(section).toContainText('1 track in the library');

  await section.getByRole('button', { name: 'Show them' }).click();
  await expect(page.getByTestId('settings')).toBeHidden();
  await expect(page.locator('header h1')).toHaveText('Missing tracks');
  await expect(page.getByTestId('list-row')).toContainText('Hunter');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('header h1')).toBeHidden();

  await openSettingsTab(page, 'Library');
  await section.getByRole('button', { name: 'Remove missing' }).click();
  const dialog = page.getByRole('dialog', { name: /^Remove/ });
  await expect(dialog).toContainText('playlist');
  await dialog.getByRole('button', { name: 'Keep them' }).click();
  await expect(section).toContainText('1 track in the library');

  await section.getByRole('button', { name: 'Remove missing' }).click();
  await dialog.getByRole('button', { name: 'Remove them' }).click();
  await expect(section).toContainText('Every song in the library is in the folder');
  await closeSettings(page);
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
  await expect(page.getByRole('tab', { name: 'Library' })).toHaveAttribute('aria-selected', 'true');
  await closeSettings(page);
});

test('toasts sit bottom left over the art beside the list, above the transport without it, and leave what is under them usable', async () => {
  await sendEvent(app, 'notice', { id: 9002, level: 'warning', message: 'Over the art', action: null });
  const toast = page.locator('[data-toast]', { hasText: 'Over the art' });
  await expect(toast).toBeVisible();
  const gutter = 40;

  await resizeWindow(app, page, 1280, 800);
  const art = await page.getByTestId('art').boundingBox();
  const overArt = await toast.boundingBox();
  if (!art || !overArt) throw new Error('No box');
  expect(overArt.x).toBeGreaterThanOrEqual(art.x);
  expect(overArt.x - art.x).toBeLessThan(gutter);
  expect(overArt.x + overArt.width).toBeLessThanOrEqual(art.x + art.width + 1);
  expect(overArt.y + overArt.height).toBeLessThanOrEqual(art.y + art.height + 1);
  expect(art.y + art.height - (overArt.y + overArt.height)).toBeLessThan(gutter);

  await resizeWindow(app, page, 800, 1100);
  const transport = await page.getByTestId('transport').boundingBox();
  const overList = await toast.boundingBox();
  if (!transport || !overList) throw new Error('No box');
  expect(Math.abs(overList.x + overList.width / 2 - 400)).toBeLessThan(2);
  expect(overList.y + overList.height).toBeLessThanOrEqual(transport.y + 1);
  expect(transport.y - (overList.y + overList.height)).toBeLessThan(gutter);
  await resizeWindow(app, page, 1280, 800);

  // A fresh one, since a toast only lasts a few seconds.
  await sendEvent(app, 'notice', { id: 9003, level: 'warning', message: 'Under the panel', action: null });
  const fresh = page.locator('[data-toast]', { hasText: 'Under the panel' });
  await expect(fresh).toBeVisible();
  const box = await fresh.boundingBox();
  if (!box) throw new Error('No box');
  const hitsToast = ([x, y]: readonly [number, number]) => !!document.elementFromPoint(x, y)?.closest('[data-toast]');
  const body = [box.x + box.width / 3, box.y + box.height / 2] as const;
  expect(await page.evaluate(hitsToast, body)).toBe(true);
  // Lyrics over the art keep their taps where a toast lies over them, and the toast keeps its own buttons.
  await page.keyboard.press('l');
  await expect(page.getByTestId('lyrics')).toBeVisible();
  expect(await page.evaluate(hitsToast, body)).toBe(false);
  await fresh.getByRole('button', { name: 'Dismiss' }).click();
  await expect(fresh).toBeHidden();
  await page.keyboard.press('l');
  await expect(page.getByTestId('lyrics')).toHaveCount(0);
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

test('the strip along the top drags the window, and the gear and the search field are not part of it', async () => {
  const regions = await page.evaluate(() => {
    const appRegion = (element: Element | null) =>
      element ? getComputedStyle(element).getPropertyValue('app-region') : null;
    const strip = document.querySelector('[data-testid="title-bar"]');
    const search = document.querySelector('input[type="search"]');
    return {
      strip: appRegion(strip),
      gear: appRegion(document.querySelector('[aria-label="Settings"]')),
      search: appRegion(search),
      searchIsBelowStrip:
        strip !== null && search !== null && search.getBoundingClientRect().top >= strip.getBoundingClientRect().bottom,
    };
  });
  expect(regions.strip).toBe('drag');
  expect(regions.gear).toBe('no-drag');
  expect(regions.search).not.toBe('drag');
  expect(regions.searchIsBelowStrip).toBe(true);
});

test('an empty folder says so, with the way out', async () => {
  const empty = join(E2E, 'Empty');
  mkdirSync(empty, { recursive: true });
  await openSettingsTab(page, 'Library');
  await stubFolderDialog(app, empty);
  await page.getByRole('button', { name: 'Change folder' }).click();

  await expect(page.getByText('No music found in this folder')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Rescan' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change folder' })).toBeVisible();
  await page.screenshot({ path: join(SCREENSHOTS, 'empty-folder-1280x800.png') });

  await tab('Playlists').click();
  await expect(page.getByText('No playlists yet')).toBeVisible();
  const queue = page.getByRole('dialog', { name: 'Queue' });
  await page.getByRole('button', { name: 'Queue', exact: true }).first().click();
  await expect(queue.getByText('Nothing queued')).toBeVisible();
  await page.getByRole('button', { name: 'Close queue' }).first().click();
  await expect(queue).toHaveCount(0);
  await tab('Albums').click();

  await stubFolderDialog(app, MUSIC);
  await page.getByRole('button', { name: 'Change folder' }).click();
  await tab('Albums').click();
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

  await openSettingsTab(page, 'Library');
  await page.getByRole('button', { name: 'Rescan' }).click();

  await expect(page.getByRole('heading', { name: "Can't find your music" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(MUSIC)).toBeVisible();
  await page.screenshot({ path: join(SCREENSHOTS, 'folder-missing-1280x800.png') });

  // Still gone: the screen stays, and says it tried.
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText("That folder still isn't there", { exact: true })).toBeVisible();
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

  await openSettingsTab(page, 'Library');
  await expect(page.getByTestId('settings').getByRole('region', { name: 'Storage', exact: true })).toContainText(
    'On THE-MAIN-MACHINE at',
  );
  await expect(page.getByTestId('scan-report')).toBeVisible();
  await closeSettings(page);
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
  await tab('Albums').click();
  await expect(page.getByTestId('album-card').first()).toBeVisible();
});

test('nothing logged an error along the way', () => {
  expect(problems).toEqual([]);
});
