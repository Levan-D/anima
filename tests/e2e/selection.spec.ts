/*
 * Multi-select, touch and the TV: selection through the real menu and drag, fingers over CDP, a keyboard walk that looks
 * at every focus ring, the size keys, and the tabs at tight sizes. Writes to .dev/e2e-selection/ and screenshots to
 * .dev/screenshots/phase5/.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { CDPSession, ElectronApplication, Locator, Page } from 'playwright';
import type { PlaylistDetail, PlaylistSummary, QueueItem, Track } from '@shared/domain';
import type { Result } from '@shared/result';
import { launchApp, resizeWindow, ROOT, settled, stubFolderDialog } from './helpers/app';
import { generatedLibrary } from './helpers/generatedLibrary';

const E2E = join(ROOT, '.dev', 'e2e-selection');
const MUSIC = join(E2E, 'Music');
const SCREENSHOTS = join(ROOT, '.dev', 'screenshots', 'phase5');

let app: ElectronApplication;
let page: Page;

const tab = (name: string) => page.getByRole('tab', { name, exact: true });
const rows = () => page.getByTestId('list-row');
const bar = () => page.getByTestId('selection-bar');

async function value<T>(name: string, input?: unknown): Promise<T> {
  const result = await page.evaluate(
    ([command, args]) => (window.api.invoke as (...all: unknown[]) => Promise<Result<unknown>>)(command, args),
    [name, input] as const,
  );
  if (!result.ok) throw new Error(`${name}: ${result.error.message}`);
  return result.value as T;
}

const queueTitles = async () => (await value<QueueItem[]>('player.queue')).map(({ track }) => track.title);

async function rowTitle(row: Locator): Promise<string> {
  const title = await row.getAttribute('title');
  if (title === null) throw new Error('The row has no title');
  return title;
}

/** By way of another tab, so nothing stays selected from before. */
async function openTracks(): Promise<void> {
  await tab('Artists').click();
  await tab('Tracks').click();
  await rows().first().waitFor();
  await page.getByTestId('list-scroller').evaluate((element) => {
    element.scrollTop = 0;
  });
  await settled(page);
}

async function clearAnySelection(): Promise<void> {
  if (await bar().isVisible()) await bar().getByRole('button', { name: 'Done' }).click();
}

async function setUiScale(uiScale: number): Promise<void> {
  await value('settings.update', { uiScale });
  await page.waitForFunction(
    (scale) => document.documentElement.style.getPropertyValue('--ui-scale') === String(scale),
    uiScale,
  );
  await settled(page);
}

const uiScale = () => page.evaluate(() => document.documentElement.style.getPropertyValue('--ui-scale'));

/* Fingers, over CDP as in playback.spec.ts. */

async function fingers(): Promise<CDPSession> {
  return page.context().newCDPSession(page);
}

type Point = { x: number; y: number };

async function centerOf(locator: Locator): Promise<Point> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('It has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function tap(session: CDPSession, at: Point, holdMs = 30): Promise<void> {
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
  await page.waitForTimeout(holdMs);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function drag(session: CDPSession, from: Point, to: Point): Promise<void> {
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let step = 1; step <= 6; step++) {
    const at = { x: from.x + ((to.x - from.x) * step) / 6, y: from.y + ((to.y - from.y) * step) / 6 };
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at] });
    await page.waitForTimeout(16);
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/* What a ring looks like, from what the DOM can say about it. */

type FocusSeen = { name: string; width: number; problem: string | null };

function focusSeen(): Promise<FocusSeen> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement) || element === document.body) {
      return { name: 'nothing', width: 0, problem: 'focus fell to the page' };
    }
    const name = element.getAttribute('aria-label') ?? element.textContent?.slice(0, 40) ?? element.tagName;

    // The art pane's ring is a shadow on top of the art, since an outline would be under it.
    const paneRing = /0px 0px 0px ([\d.]+)px inset/.exec(getComputedStyle(element, '::after').boxShadow)?.[1];
    if (paneRing !== undefined) return { name, width: Number.parseFloat(paneRing), problem: null };

    const hasRing = (candidate: Element) => {
      const { outlineStyle, outlineWidth } = getComputedStyle(candidate);
      return outlineStyle !== 'none' && Number.parseFloat(outlineWidth) > 0;
    };
    // The seekbar's thumb has no size. It draws on the dot that follows it.
    const ringed = hasRing(element)
      ? element
      : [...(element.closest('.group')?.querySelectorAll('*') ?? [])].find(hasRing);
    if (!ringed) return { name, width: 0, problem: 'no ring' };

    const { outlineWidth, outlineOffset } = getComputedStyle(ringed);
    const width = Number.parseFloat(outlineWidth);
    const reach = Math.max(width + Number.parseFloat(outlineOffset), 0);
    const box = ringed.getBoundingClientRect();
    for (let parent = ringed.parentElement; parent; parent = parent.parentElement) {
      const { overflowX, overflowY } = getComputedStyle(parent);
      const clip = parent.getBoundingClientRect();
      const cutSideways =
        overflowX !== 'visible' && (box.left - reach < clip.left - 1 || box.right + reach > clip.right + 1);
      const cutUpDown =
        overflowY !== 'visible' && (box.top - reach < clip.top - 1 || box.bottom + reach > clip.bottom + 1);
      if (cutSideways || cutUpDown) return { name, width, problem: `clipped by ${parent.className.slice(0, 50)}` };
    }
    return { name, width, problem: null };
  });
}

/** Tabs until focus comes back round, and says what it found. Fails on nothing, so the caller can word what matters. */
async function walkWithTab(limit = 60): Promise<{ stops: FocusSeen[]; wentRound: boolean }> {
  const stops: FocusSeen[] = [];
  const mark = () =>
    page.evaluate(() => {
      const key = '__walkMark';
      const element = document.activeElement as (HTMLElement & Record<string, unknown>) | null;
      const was = element?.[key] === true;
      if (element) element[key] = true;
      return was;
    });

  for (let step = 0; step < limit; step++) {
    await page.keyboard.press('Tab');
    if (await mark()) return { stops, wentRound: true };
    stops.push(await focusSeen());
  }
  return { stops, wentRound: false };
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
  await resizeWindow(app, page, 1280, 800);

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

test('one click selects a row with no bar, the next moves it, and two play it', async () => {
  await openTracks();
  await rows().nth(1).click();
  await expect(rows().nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(bar()).toBeHidden();
  const surface = (row: Locator) => row.evaluate((element) => getComputedStyle(element).backgroundColor);
  await page.mouse.move(0, 0);
  await expect
    .poll(() => surface(rows().nth(1)))
    .toBe(
      await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.background = 'var(--surface-active)';
        document.body.append(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
      }),
    );
  expect((await value<{ current: Track | null }>('player.state')).current).toBeNull();

  await rows().nth(3).click();
  await expect(rows().nth(3)).toHaveAttribute('aria-pressed', 'true');
  await expect(rows().nth(1)).not.toHaveAttribute('aria-pressed', 'true');

  await rows()
    .nth(4)
    .click({ modifiers: ['Control'] });
  await expect(bar()).toContainText('2 selected');
  await rows().nth(5).click();
  await expect(bar()).toBeHidden();
  await expect(rows().nth(5)).toHaveAttribute('aria-pressed', 'true');
  await expect(rows().nth(4)).not.toHaveAttribute('aria-pressed', 'true');

  const title = await rowTitle(rows().nth(2));
  await rows().nth(2).dblclick();
  await expect.poll(async () => (await value<{ current: Track | null }>('player.state')).current?.title).toBe(title);
  await expect(rows().nth(2)).toHaveAttribute('aria-pressed', 'true');
  await value('player.clearQueue');
});

test('Ctrl+click toggles, Shift+click extends, a plain click clears and plays nothing', async () => {
  await openTracks();
  await rows()
    .nth(1)
    .click({ modifiers: ['Control'] });
  await rows()
    .nth(3)
    .click({ modifiers: ['Control'] });
  await expect(bar()).toContainText('2 selected');
  await rows()
    .nth(1)
    .click({ modifiers: ['Control'] });
  await expect(bar()).toBeHidden();

  await rows()
    .nth(6)
    .click({ modifiers: ['Shift'] });
  await expect(bar()).toContainText('6 selected');
  await expect(rows().nth(4)).toHaveAttribute('aria-pressed', 'true');
  await expect(rows().nth(0)).not.toHaveAttribute('aria-pressed', 'true');

  await rows().nth(0).click();
  await expect(bar()).toBeHidden();
  await expect(rows().nth(4)).not.toHaveAttribute('aria-pressed', 'true');
  expect((await value<{ current: Track | null }>('player.state')).current).toBeNull();
});

test('Ctrl+A takes the whole list, Esc clears it, and only the next Esc goes back', async () => {
  await openTracks();
  const { length: total } = await value<Track[]>('library.tracks', { filter: { kind: 'all' } }).catch(() => []);
  await rows().first().focus();
  await page.keyboard.press('Control+a');
  await expect(bar()).toBeVisible();
  if (total > 0) await expect(bar()).toContainText(`${total} selected`);
  await page.keyboard.press('Escape');
  await expect(bar()).toBeHidden();

  await tab('Albums').click();
  await page.getByTestId('album-card').first().click();
  await rows().first().waitFor();
  const back = page.getByRole('button', { name: 'Back' });
  await rows()
    .first()
    .click({ modifiers: ['Control'] });
  await rows()
    .nth(1)
    .click({ modifiers: ['Control'] });
  await expect(bar()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bar()).toBeHidden();
  await expect(back).toBeVisible();
  await rows().first().click();
  await page.keyboard.press('Escape');
  await expect(back).toBeHidden();
});

test('Shift+Down and Shift+Up extend and shrink from the row with focus', async () => {
  await openTracks();
  await rows().nth(2).focus();
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(bar()).toContainText('3 selected');
  await page.keyboard.press('Shift+ArrowUp');
  await expect(bar()).toContainText('2 selected');
  await page.keyboard.press('Escape');
  await expect(bar()).toBeHidden();
});

test('a selection leaves when the list changes', async () => {
  await openTracks();
  await rows()
    .first()
    .click({ modifiers: ['Control'] });
  await rows()
    .nth(1)
    .click({ modifiers: ['Control'] });
  await expect(bar()).toBeVisible();
  await tab('Artists').click();
  await expect(bar()).toBeHidden();
});

test('the menu of a selected row queues all of it, and of another row just that one', async () => {
  await value('player.clearQueue');
  await openTracks();
  const titles = [await rowTitle(rows().nth(0)), await rowTitle(rows().nth(1)), await rowTitle(rows().nth(2))];
  await rows().nth(0).click();
  await rows()
    .nth(2)
    .click({ modifiers: ['Shift'] });
  await expect(bar()).toContainText('3 selected');

  await rows().nth(1).click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu.getByText('3 tracks')).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Reveal in File Explorer' })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'Add to queue' }).click();
  await expect.poll(queueTitles).toEqual(titles);
  await expect(page.getByText('Added to the queue: 3 tracks', { exact: true })).toBeVisible();
  // Done stays free to tap: toasts are over the art, and the bar is over the list.
  const toastBox = await page.locator('[data-toast]').first().boundingBox();
  const barBox = await bar().boundingBox();
  expect((toastBox?.x ?? 0) + (toastBox?.width ?? 0)).toBeLessThanOrEqual(barBox?.x ?? 0);

  await rows().nth(5).click({ button: 'right' });
  await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Reveal in File Explorer' })).toBeVisible();
  // With a toast up, Radix can give Esc to the toast first. Either way it mustn't reach the selection behind the menu.
  await page.keyboard.press('Escape');
  await expect(bar()).toContainText('3 selected');
  await expect(async () => {
    if (await page.getByRole('menu').isVisible()) await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0, { timeout: 200 });
  }).toPass();
  await expect(bar()).toContainText('3 selected');
  await page.keyboard.press('Escape');
  await expect(bar()).toBeHidden();
});

test('in the queue, a drag moves the selection together, and the menu removes it', async () => {
  await value('player.clearQueue');
  await openTracks();
  await rows().nth(0).click();
  await rows()
    .nth(4)
    .click({ modifiers: ['Shift'] });
  await rows().nth(0).click({ button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name: 'Add to queue' }).click();
  await expect.poll(async () => (await queueTitles()).length).toBe(5);
  const before = await queueTitles();

  // The queue is a sheet, and its rows share their test id with the library's under it.
  const sheet = page.getByRole('dialog', { name: 'Queue' });
  const queued = () => sheet.getByTestId('list-row');
  const sheetBar = () => sheet.getByTestId('selection-bar');
  await page.getByRole('button', { name: 'Queue', exact: true }).first().click();
  await queued().first().waitFor();
  await queued()
    .nth(0)
    .click({ modifiers: ['Control'] });
  await queued()
    .nth(2)
    .click({ modifiers: ['Control'] });

  const from = await centerOf(queued().nth(0));
  const to = await queued().nth(4).boundingBox();
  if (!to) throw new Error('No row to drop on');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 20, { steps: 3 });
  await page.mouse.move(from.x, to.y + to.height * 0.9, { steps: 6 });
  await page.waitForTimeout(100);
  await page.mouse.up();

  const [one, two, three, four, five] = before;
  await expect.poll(queueTitles).toEqual([two, four, five, one, three]);
  await expect(sheetBar()).toContainText('2 selected');

  await queued().nth(3).click({ button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name: 'Remove from queue' }).click();
  await expect.poll(queueTitles).toEqual([two, four, five]);
  await expect(sheetBar()).toBeHidden();
  await page.getByRole('button', { name: 'Close queue' }).first().click();
  await expect(sheet).toHaveCount(0);
});

test('in a playlist, a selection queues together, and the page itself removes nothing: that is the editor', async () => {
  const tracks = await value<QueueItem[]>('player.queue');
  await value('player.clearQueue');
  const ids = tracks.map(({ track }) => track.id);
  const playlist = await value<PlaylistSummary>('playlist.create', { name: 'Picked', trackIds: ids });
  await tab('Playlists').click();
  await page.getByRole('button', { name: /Picked/ }).click();
  await rows().first().waitFor();

  await rows()
    .nth(1)
    .click({ modifiers: ['Control'] });
  await rows()
    .nth(2)
    .click({ modifiers: ['Control'] });
  await expect(bar()).toContainText('2 selected');
  await rows().nth(1).click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Remove from playlist' })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'Add to queue' }).click();
  await expect.poll(async () => (await queueTitles()).length).toBe(2);
  expect((await value<PlaylistDetail>('playlist.get', { playlistId: playlist.id })).items).toHaveLength(ids.length);
  await clearAnySelection();
  await page.keyboard.press('Escape');
});

test('a long press offers Select, taps then toggle, and Done gets out', async () => {
  await openTracks();
  await value('player.clearQueue');
  const session = await fingers();
  await tap(session, await centerOf(rows().nth(2)), 900);
  await page.getByRole('menu').getByRole('menuitem', { name: 'Select', exact: true }).click();
  await expect(bar()).toContainText('1 selected');
  // Tight rows sit under the menu while it fades.
  await expect(page.getByRole('menu')).toHaveCount(0);

  await tap(session, await centerOf(rows().nth(4)));
  await expect(bar()).toContainText('2 selected');
  await tap(session, await centerOf(rows().nth(2)));
  await expect(bar()).toContainText('1 selected');
  expect((await value<{ current: Track | null }>('player.state')).current).toBeNull();

  const done = bar().getByRole('button', { name: 'Done' });
  const box = await done.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await tap(session, await centerOf(done));
  await expect(bar()).toBeHidden();
  await session.detach();
});

test('a right-click does not offer Select', async () => {
  await openTracks();
  await rows().nth(1).click({ button: 'right' });
  await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Select', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('a finger across the art changes track, and nothing else does', async () => {
  await openTracks();
  await rows().nth(1).dblclick();
  await expect.poll(async () => (await value<{ queueIndex: number | null }>('player.state')).queueIndex).toBe(1);
  await page.keyboard.press('Space');

  const queueIndex = async () => (await value<{ queueIndex: number | null }>('player.state')).queueIndex;
  const art = page.getByTestId('now-playing');
  const box = await art.boundingBox();
  if (!box) throw new Error('No art');
  const y = box.y + box.height / 2;
  const left = { x: box.x + box.width * 0.2, y };
  const right = { x: box.x + box.width * 0.8, y };
  const session = await fingers();

  await drag(session, right, left);
  await expect.poll(queueIndex).toBe(2);
  await drag(session, left, right);
  await expect.poll(queueIndex).toBe(1);
  await expect(page.getByTestId('lyrics')).toHaveCount(0);

  // Too short, then mostly vertical.
  await drag(session, { x: box.x + box.width * 0.5, y }, { x: box.x + box.width * 0.45, y });
  await drag(session, { x: box.x + box.width * 0.5, y: box.y + 200 }, { x: box.x + box.width * 0.2, y: box.y + 700 });
  await page.waitForTimeout(200);
  expect(await queueIndex()).toBe(1);
  await expect(art.locator('[style*="translateX"]')).toHaveCount(0);

  // It leans after the finger on the way.
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [right] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: right.x - 100, y }] });
  await expect(art.locator('[style*="translateX"]')).toHaveCount(1);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(art.locator('[style*="translateX"]')).toHaveCount(0);

  // A mouse doing the same is nothing, and its click opens the lyrics.
  await page.mouse.move(right.x, right.y);
  await page.mouse.down();
  await page.mouse.move(left.x, left.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  expect(await queueIndex()).toBe(1);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('lyrics')).toHaveCount(0);
  await tap(session, await centerOf(art));
  await expect(page.getByTestId('lyrics')).toBeVisible();
  await page.keyboard.press('Escape');
  await session.detach();
});

test('under a coarse pointer the scrollbar thumb is at least a finger long', async () => {
  // Emulating touch swaps in overlay scrollbars, which aren't what a touch laptop's Windows gets. So this takes the real
  // rule out of the stylesheet and puts it on a test scroller, which is what Chromium's rules for the thumb need to see.
  const hasRule = await page.evaluate(() => {
    const rules = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]);
    const walk = (list: CSSRule[]): string | null => {
      for (const rule of list) {
        if (rule instanceof CSSMediaRule && rule.conditionText.includes('any-pointer: coarse')) {
          const inner = [...rule.cssRules].find(
            (one) => one instanceof CSSStyleRule && one.selectorText === '::-webkit-scrollbar-thumb',
          );
          if (inner instanceof CSSStyleRule) return inner.style.cssText;
        }
        if (rule instanceof CSSLayerBlockRule || rule instanceof CSSMediaRule) {
          const found = walk([...rule.cssRules]);
          if (found !== null) return found;
        }
      }
      return null;
    };
    const declarations = walk(rules);
    if (declarations === null) return false;

    // Through the CSSOM, because the page's CSP refuses inline styles.
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(
      `#thumb-probe::-webkit-scrollbar { width: 20px } #thumb-probe::-webkit-scrollbar-thumb { background: #fff; ${declarations} }`,
    );
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    const outer = document.createElement('div');
    outer.id = 'thumb-probe';
    outer.style.cssText =
      'position:fixed;left:0;top:0;width:60px;height:300px;overflow-y:scroll;z-index:99;background:#000';
    const inner = document.createElement('div');
    inner.style.height = '200000px';
    outer.append(inner);
    document.body.append(outer);
    return true;
  });
  expect(hasRule).toBe(true);
  await settled(page);

  // Screenshots leave scrollbars out. A press on the track pages the list, and a press on the thumb doesn't.
  const pressAt = async (y: number) => {
    await page.evaluate(() => {
      const probe = document.getElementById('thumb-probe');
      if (probe) probe.scrollTop = 0;
    });
    await page.mouse.move(50, y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(100);
    return page.evaluate(() => document.getElementById('thumb-probe')?.scrollTop ?? -1);
  };
  const onThumb = await pressAt(40);
  const onTrack = await pressAt(100);
  await page.evaluate(() => {
    document.getElementById('thumb-probe')?.remove();
    document.adoptedStyleSheets = [];
  });
  expect(onThumb).toBe(0);
  expect(onTrack).toBeGreaterThan(0);
});

test('every control a finger uses in the main view is at least a tap wide and tall', async () => {
  await resizeWindow(app, page, 1280, 800);
  await openTracks();
  const small = await page.evaluate(() =>
    // A label is the target for what's in it: the search field and the exclusive switch. The Tracks tab's tight rows
    // are under the floor on purpose, and the same rows elsewhere are checked by the smoke test.
    [
      ...document.querySelectorAll<HTMLElement>(
        'button:not([data-testid="now-playing-details"] button):not([data-tight]), [role="tab"], label',
      ),
    ]
      .filter((element) => element.getClientRects().length > 0 && element.parentElement?.closest('label') == null)
      .filter((element) => {
        const { width, height } = element.getBoundingClientRect();
        return width < 43.5 || height < 43.5;
      })
      .map((element) => element.getAttribute('aria-label') ?? element.textContent),
  );
  expect(small).toEqual([]);
  const mini = page.getByRole('button', { name: 'Mini player' }).first();
  await expect(mini).toBeVisible();
});

test('a keyboard walk finds a ring on every stop at 3840x2160, and goes round', async () => {
  await resizeWindow(app, page, 3840, 2160);
  await openTracks();
  await tab('Tracks').focus();

  const main = await walkWithTab();
  expect(main.stops.filter(({ problem }) => problem !== null)).toEqual([]);
  expect(main.wentRound).toBe(true);
  expect(main.stops.length).toBeGreaterThan(6);
  expect(Math.min(...main.stops.map(({ width }) => width))).toBeGreaterThanOrEqual(5);

  await page.getByRole('button', { name: 'Settings' }).focus();
  await page.keyboard.press('Enter');
  await page.getByTestId('settings').waitFor();
  const settings = await walkWithTab();
  expect(settings.stops.filter(({ problem }) => problem !== null)).toEqual([]);
  await page.keyboard.press('Escape');
});

test('a focused row is never under the fade, right down to the last', async () => {
  await resizeWindow(app, page, 1000, 800);
  await openTracks();
  await rows().first().focus();
  const fadeTop = await page.getByTestId('transport').evaluate((element) => {
    const fade = Number.parseFloat(getComputedStyle(element, '::before').height);
    return element.getBoundingClientRect().top - fade;
  });
  await page.keyboard.press('End');
  await settled(page);
  for (let step = 0; step < 3; step++) {
    const bottom = await page.evaluate(() => document.activeElement?.getBoundingClientRect().bottom ?? 0);
    expect(bottom).toBeLessThanOrEqual(fadeTop + 1);
    await page.keyboard.press('ArrowUp');
    await settled(page);
  }
  await page.keyboard.press('Home');
  for (let step = 0; step < 30; step++) await page.keyboard.press('ArrowDown');
  await settled(page);
  const bottom = await page.evaluate(() => document.activeElement?.getBoundingClientRect().bottom ?? 0);
  expect(bottom).toBeLessThanOrEqual(fadeTop + 1);
});

test('overlays and dialogs keep Tab inside, and give focus back', async () => {
  await resizeWindow(app, page, 1920, 1080);
  await openTracks();
  const row = rows().nth(3);
  await row.focus();
  const title = await rowTitle(row);
  const backOnRow = async () =>
    expect(await page.evaluate(() => document.activeElement?.getAttribute('title'))).toBe(title);

  for (const [key, panel] of [
    ['e', 'equalizer'],
    ['l', 'lyrics'],
  ] as const) {
    await page.keyboard.press(key);
    await page.getByTestId(panel).waitFor();
    await settled(page);
    for (let step = 0; step < 25; step++) {
      await page.keyboard.press('Tab');
      const isInside = await page.evaluate((id) => {
        // The equalizer is a dialog, with its header outside what scrolls.
        const panel = document.querySelector(`[data-testid="${id}"]`);
        return (panel?.closest('[role="dialog"]') ?? panel)?.contains(document.activeElement) ?? false;
      }, panel);
      expect(isInside, `${panel}, Tab ${step}`).toBe(true);
    }
    // A tooltip fading out still takes the next Escape, and Tab went past several faster than they fade.
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByTestId(panel).waitFor({ state: 'detached' });
    await backOnRow();
  }

  await page.keyboard.press('?');
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  for (let step = 0; step < 5; step++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    expect((await focusSeen()).problem).toBeNull();
  }
  await expect(page.getByTestId('hotkey-list')).toContainText('Interface size');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await backOnRow();

  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu');
  await menu.waitFor();
  await page.keyboard.press('ArrowDown');
  expect((await focusSeen()).problem).toBeNull();
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached' });
  await backOnRow();
});

test('Ctrl+= and Ctrl+- step the interface size, and Ctrl+0 resets it', async () => {
  await resizeWindow(app, page, 1920, 1080);
  await setUiScale(1);
  await page.keyboard.press('Control+=');
  await expect.poll(uiScale).toBe('1.1');
  await page.keyboard.press('Control+=');
  await expect.poll(uiScale).toBe('1.2');
  await page.keyboard.press('Control+-');
  await expect.poll(uiScale).toBe('1.1');
  await expect.poll(async () => (await value<{ uiScale: number }>('settings.get')).uiScale).toBe(1.1);
  await page.keyboard.press('Control+0');
  await expect.poll(uiScale).toBe('1');
  await expect.poll(async () => (await value<{ uiScale: number }>('settings.get')).uiScale).toBe(1);
});

test('the tabs stay on one row, the queue opens, and the list keeps three rows at every tight size', async () => {
  const sizes = [
    [1920, 1080, 2.25],
    [1000, 800, 1],
    [1024, 640, 1],
    [1000, 800, 2.25],
    [1024, 640, 2.25],
    [800, 1000, 1],
    [640, 480, 1],
  ] as const;

  await openTracks();
  for (const [width, height, scale] of sizes) {
    await resizeWindow(app, page, width, height);
    await setUiScale(scale);
    await tab('Tracks').click();
    await rows().first().waitFor();
    await settled(page);
    const where = `${width}x${height} at ${scale}`;

    const tops = await page.getByRole('tab').evaluateAll((tabs) => tabs.map((one) => one.getBoundingClientRect().top));
    expect(new Set(tops).size, where).toBe(1);

    const scroller = await page.getByTestId('list-scroller').evaluate((element) => element.clientHeight);
    const rowHeight = (await rows().first().boundingBox())?.height ?? 0;
    const fade = await page
      .getByTestId('transport')
      .evaluate((element) => Number.parseFloat(getComputedStyle(element, '::before').height));
    expect(scroller - fade, where).toBeGreaterThanOrEqual(rowHeight * 3);

    await page.keyboard.press('q');
    const queue = page.getByRole('dialog', { name: 'Queue' });
    await expect(queue).toBeVisible();
    await settled(page);
    const box = await queue.boundingBox();
    expect(box !== null && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1, where).toBe(true);
    await page.screenshot({ path: join(SCREENSHOTS, `tabs-${width}x${height}-${scale * 100}.png`) });
    await page.getByRole('button', { name: 'Close queue' }).first().click();
    await expect(queue).toHaveCount(0);
  }
  await setUiScale(1);
});

test('as it looks: rings at 3840x2160, a selection at 1280x800', async () => {
  await resizeWindow(app, page, 3840, 2160);
  await openTracks();
  await rows()
    .nth(3)
    .click({ modifiers: ['Control'] });
  await rows()
    .nth(5)
    .click({ modifiers: ['Control'] });
  await rows().nth(4).focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.screenshot({ path: join(SCREENSHOTS, 'ring-row-3840.png') });
  await clearAnySelection();
  await tab('Tracks').focus();
  await page.keyboard.press('ArrowRight');
  await page.screenshot({ path: join(SCREENSHOTS, 'ring-tab-3840.png') });
  await tab('Tracks').focus();
  await page
    .getByRole('button', { name: 'Play next track' })
    .first()
    .focus()
    .catch(() => {});
  await page.screenshot({ path: join(SCREENSHOTS, 'ring-transport-3840.png') });

  await resizeWindow(app, page, 1280, 800);
  await openTracks();
  await rows()
    .nth(1)
    .click({ modifiers: ['Control'] });
  await rows()
    .nth(4)
    .click({ modifiers: ['Shift'] });
  await page.screenshot({ path: join(SCREENSHOTS, 'selection-1280.png') });
  await clearAnySelection();
});
