/*
 * What a keyboard, and a window that changes size, do to the list, in the real layout. jsdom has no focus rings, no
 * real scrolling and no tab order to speak of, so this is where those get looked at. Runs on the generated library.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { launchApp, resizeWindow, ROOT, settled, stubFolderDialog } from './helpers/app';
import { generatedLibrary } from './helpers/generatedLibrary';

const E2E = join(ROOT, '.dev', 'e2e-keyboard');
const MUSIC = join(E2E, 'Music');
const SCREENSHOTS = join(ROOT, '.dev', 'screenshots', 'phase2-fixes');

let app: ElectronApplication;
let page: Page;

function tab(name: string) {
  return page.getByRole('tab', { name, exact: true });
}

function scroller() {
  return page.getByTestId('list-scroller');
}

function focused() {
  return page.evaluate(() => {
    const element = document.activeElement;
    return {
      tag: element?.tagName,
      role: element?.getAttribute('role'),
      testId: element?.getAttribute('data-testid'),
      index: element?.closest('[data-index]')?.getAttribute('data-index') ?? null,
      text: element?.textContent,
    };
  });
}

async function firstVisibleText(): Promise<string | null> {
  return page.evaluate(() => {
    const top = document.querySelector('[data-testid="list-scroller"]')?.getBoundingClientRect().top ?? 0;
    const items = [...document.querySelectorAll('[data-index]')];
    const first = items
      .filter((item) => item.getBoundingClientRect().bottom > top + 1)
      .toSorted((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
    return first?.querySelector('button')?.textContent ?? null;
  });
}

async function scrollListTo(top: number): Promise<void> {
  await scroller().evaluate((element, value) => {
    element.scrollTop = value;
  }, top);
  await settled(page);
}

async function setUiScale(uiScale: number): Promise<void> {
  await page.evaluate((value) => window.api.invoke('settings.update', { uiScale: value }), uiScale);
  await page.waitForFunction(
    (value) => document.documentElement.style.getPropertyValue('--ui-scale') === String(value),
    uiScale,
  );
  await settled(page);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(300_000);
  rmSync(E2E, { recursive: true, force: true });
  mkdirSync(SCREENSHOTS, { recursive: true });
  await generatedLibrary(MUSIC);
  app = await launchApp({ userData: join(E2E, 'user-data'), dataRoot: join(E2E, 'data') });
  page = await app.firstWindow();
  await page.waitForLoadState('load');
  await resizeWindow(app, page, 1920, 1080);

  await stubFolderDialog(app, MUSIC);
  await page.getByRole('button', { name: 'Choose a folder' }).click();
  await page.getByRole('tab', { name: 'Albums', exact: true }).click();
  await expect(page.getByTestId('album-card').first()).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(
      async () => {
        const state = await page.evaluate(() => window.api.invoke('scan.state'));
        return state.ok ? state.value.phase : 'failed';
      },
      { timeout: 120_000 },
    )
    .toBe('idle');
});

test.afterAll(async () => {
  await app.close();
});

test('from the search field, Arrow Down and Enter go straight to the results, and Arrow Up comes back', async () => {
  const field = page.getByRole('searchbox');
  for (const key of ['ArrowDown', 'Enter']) {
    await field.fill('harbour');
    await page.getByRole('heading', { name: 'Artists' }).waitFor();
    await settled(page);
    await field.focus();
    await page.keyboard.press(key);
    expect(await focused()).toMatchObject({ testId: 'list-row' });
    await page.keyboard.press('ArrowUp');
    expect(await focused()).toMatchObject({ tag: 'INPUT' });
  }
});

test('leaving search from a result leaves the arrow keys working, and from the field stays in the field', async () => {
  const field = page.getByRole('searchbox');
  await field.fill('harbour');
  await page.getByRole('heading', { name: 'Artists' }).waitFor();
  await field.focus();
  await page.keyboard.press('ArrowDown');
  expect(await focused()).toMatchObject({ testId: 'list-row' });

  await page.keyboard.press('Escape');
  await expect(field).toHaveValue('');
  await expect.poll(async () => (await focused()).testId).toBe('album-card');
  const before = await focused();
  await page.keyboard.press('ArrowRight');
  expect((await focused()).text).not.toBe(before.text);

  await field.fill('harbour');
  await page.getByRole('heading', { name: 'Artists' }).waitFor();
  await field.focus();
  await page.keyboard.press('Escape');
  await expect(field).toHaveValue('');
  expect(await focused()).toMatchObject({ tag: 'INPUT' });

  await field.fill('zzzzzz');
  const clear = page.getByRole('button', { name: 'Clear search' }).last();
  await clear.waitFor();
  await clear.focus();
  await page.keyboard.press('Enter');
  await expect(field).toHaveValue('');
  await expect.poll(async () => (await focused()).tag).not.toBe('BODY');
});

test('Arrow Down on a tab goes into its list, and Arrow Up from the first row comes back to the tab', async () => {
  await tab('Albums').click();
  await settled(page);
  await tab('Albums').focus();
  await page.keyboard.press('ArrowDown');
  expect(await focused()).toMatchObject({ testId: 'album-card', index: '0' });
  await page.keyboard.press('ArrowUp');
  expect(await focused()).toMatchObject({ role: 'tab', text: 'Albums' });
});

test('Tab goes tabs, search, first card, and Shift+Tab back, never stopping on the list itself', async () => {
  // A scan's line has a Cancel of its own between search and the list, so this waits for none to be running.
  await expect
    .poll(async () => {
      const state = await page.evaluate(() => window.api.invoke('scan.state'));
      return state.ok ? state.value.phase : 'failed';
    })
    .toBe('idle');
  // With words in it, search has a Clear button next, so it starts empty.
  await page.getByRole('searchbox', { name: 'Search your library' }).fill('');
  await expect(page.getByRole('button', { name: 'Clear search' })).toHaveCount(0);
  const search = { tag: 'INPUT', role: null, testId: null };
  await tab('Albums').click();
  await tab('Albums').focus();
  await page.keyboard.press('Tab');
  expect(await focused()).toMatchObject(search);
  await page.keyboard.press('Tab');
  expect(await focused()).toMatchObject({ testId: 'album-card' });
  await page.keyboard.press('Shift+Tab');
  expect(await focused()).toMatchObject(search);
  await page.keyboard.press('Shift+Tab');
  expect(await focused()).toMatchObject({ role: 'tab' });
});

test('Page Down moves about a screenful from the very first press, and Home goes all the way to the top', async () => {
  await tab('Tracks').click();
  await page.getByTestId('list-row').first().waitFor();
  await settled(page);

  const onScreen = await scroller().evaluate((element) => {
    const row = element.querySelector('[data-index="1"]')?.getBoundingClientRect().height ?? 1;
    return Math.floor(element.clientHeight / row);
  });

  await tab('Tracks').focus();
  await page.keyboard.press('ArrowDown');
  const start = Number((await focused()).index);
  await page.keyboard.press('PageDown');
  await expect.poll(async () => Number((await focused()).index)).toBe(start + onScreen - 1);
  await page.keyboard.press('PageDown');
  await expect.poll(async () => Number((await focused()).index)).toBe(start + (onScreen - 1) * 2);
  expect(await scroller().evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  await page.keyboard.press('Home');
  await expect.poll(() => scroller().evaluate((element) => element.scrollTop)).toBe(0);
});

test('a focus ring is not cut off by the window, or by the list', async () => {
  const ringTop = () =>
    page.evaluate(() => {
      const element = document.activeElement as HTMLElement;
      const { top } = element.getBoundingClientRect();
      const { outlineWidth, outlineOffset } = getComputedStyle(element);
      return top - Number.parseFloat(outlineOffset) - Number.parseFloat(outlineWidth);
    });

  for (const name of ['Settings', 'Search your library']) {
    const target = name === 'Settings' ? page.getByRole('button', { name: 'Settings' }) : page.getByRole('searchbox');
    await page.keyboard.press('Tab');
    await target.focus();
    expect(await ringTop(), name).toBeGreaterThanOrEqual(0);
  }

  // A card brought in at the top of the list by the arrow keys.
  await tab('Albums').click();
  await settled(page);
  await tab('Albums').focus();
  await page.keyboard.press('ArrowDown');
  for (let press = 0; press < 5; press++) await page.keyboard.press('ArrowDown');
  await settled(page);
  for (let press = 0; press < 3; press++) await page.keyboard.press('ArrowUp');
  await settled(page);

  const room = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement;
    const list = document.querySelector('[data-testid="list-scroller"]')?.getBoundingClientRect().top ?? 0;
    const { outlineWidth, outlineOffset } = getComputedStyle(element);
    return (
      element.getBoundingClientRect().top - list - Number.parseFloat(outlineOffset) - Number.parseFloat(outlineWidth)
    );
  });
  expect(room).toBeGreaterThanOrEqual(0);
});

test('the place in a list survives the size changing while the list was not showing', async () => {
  await tab('Tracks').click();
  await page.getByTestId('list-row').first().waitFor();
  await scrollListTo(1600);
  const before = await firstVisibleText();
  expect(before).not.toBeNull();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByTestId('settings').waitFor();
  await setUiScale(1.5);
  await page.keyboard.press('Escape');
  await page.getByTestId('settings').waitFor({ state: 'hidden' });
  await page.getByTestId('list-row').first().waitFor();
  await settled(page);

  expect(await firstVisibleText()).toBe(before);

  await setUiScale(1);
  await settled(page);
  expect(await firstVisibleText()).toBe(before);
  await scrollListTo(0);
});

test('the same goes for a window resized behind an open album', async () => {
  await tab('Albums').click();
  await settled(page);
  await scrollListTo(600);
  const before = await firstVisibleText();

  await page.getByTestId('album-card').first().waitFor();
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('[data-testid="album-card"]')?.click();
  });
  await page.locator('header h1').waitFor();

  await resizeWindow(app, page, 3840, 2160);
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByTestId('album-card').first().waitFor();
  await settled(page);
  expect(await firstVisibleText()).toBe(before);

  await resizeWindow(app, page, 1920, 1080);
  await scrollListTo(0);
});

test('a place left through a tab starts from the top next time', async () => {
  const openArtist = async () => {
    await tab('Artists').click();
    // The artist's own row, which starts with the name, not one of their tracks still fading out.
    await page
      .getByTestId('list-row')
      .filter({ hasText: /^Low Meadow/ })
      .click();
    await page.locator('header h1').waitFor();
    await settled(page);
  };

  await openArtist();
  await scrollListTo(500);
  expect(await scroller().evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  await openArtist();
  expect(await scroller().evaluate((element) => element.scrollTop)).toBe(0);
  await expect(page.locator('header h1')).toBeInViewport();
  await tab('Albums').click();
});

test('pressing the tab that is showing goes to the top of it', async () => {
  await tab('Tracks').click();
  await page.getByTestId('list-row').first().waitFor();
  await scrollListTo(1200);
  await tab('Tracks').click();
  await expect.poll(() => scroller().evaluate((element) => element.scrollTop)).toBe(0);
});

test('a long search with no spaces stays inside the column', async () => {
  const query = 'x'.repeat(200);
  await resizeWindow(app, page, 1280, 800);
  await page.getByRole('searchbox').fill(query);
  const title = page.getByText(`Nothing matches “${query}”`);
  await title.waitFor();

  const fits = await title.evaluate((element) => {
    const { left, right } = element.getBoundingClientRect();
    const column = document.querySelector('main')?.getBoundingClientRect();
    return column !== undefined && left >= column.left && right <= column.right;
  });
  expect(fits).toBe(true);
  await page.screenshot({ path: join(SCREENSHOTS, 'long-query-1280x800.png') });
  await page.getByRole('searchbox').fill('');
});

test('the album grid is three across on the 10-inch laptop, with a card of a sensible size', async () => {
  await tab('Albums').click();
  await resizeWindow(app, page, 1280, 800);
  await settled(page);
  const grid = await page.getByTestId('album-card').evaluateAll((cards) => {
    const top = cards[0]?.getBoundingClientRect().top;
    const lane = cards.filter((card) => card.getBoundingClientRect().top === top);
    return { lanes: lane.length, width: lane[0]?.getBoundingClientRect().width ?? 0 };
  });
  expect(grid.lanes).toBe(3);
  expect(grid.width).toBeGreaterThan(120);
  expect(grid.width).toBeLessThan(150);
  await page.screenshot({ path: join(SCREENSHOTS, 'albums-1280x800.png') });

  await resizeWindow(app, page, 1920, 1080);
  await page.screenshot({ path: join(SCREENSHOTS, 'albums-1920x1080.png') });
});
