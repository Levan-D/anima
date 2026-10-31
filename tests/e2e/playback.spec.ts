/*
 * Playing music through the whole UI, on the generated library, silently with --ao=null: the rows, the transport, the
 * art, the queue and what it does when things go wrong. Screenshots go to .dev/screenshots/phase3/.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { CDPSession, ElectronApplication, Page } from 'playwright';
import type { PlayerPosition, PlayerState, QueueItem, ScanState, Track } from '@shared/domain';
import {
  closeSettings,
  launchApp,
  openSettingsTab,
  resizeWindow,
  ROOT,
  sendEvent,
  settled,
  stubFolderDialog,
} from './helpers/app';
import { generatedLibrary, LONG_ALBUM_TITLE, LONG_ARTIST_NAME } from './helpers/generatedLibrary';

const E2E = join(ROOT, '.dev', 'e2e-playback');
const MUSIC = join(E2E, 'Music');
const SCREENSHOTS = join(ROOT, '.dev', 'screenshots', 'phase3');

const SIZES = [
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '2560x1440', width: 2560, height: 1440 },
  { name: '3840x2160', width: 3840, height: 2160 },
  { name: '900x1200-portrait', width: 900, height: 1200 },
  { name: '640x1600-tall', width: 640, height: 1600 },
  { name: '640x480-minimum', width: 640, height: 480 },
  { name: '767x480-short-stacked', width: 767, height: 480 },
  { name: '768x480-short-beside', width: 768, height: 480 },
  { name: '1000x800-near-square', width: 1000, height: 800 },
  { name: '1200x800-three-by-two', width: 1200, height: 800 },
  { name: '1024x640-laptop-at-125', width: 1024, height: 640 },
  { name: '853x533-laptop-at-150', width: 853, height: 533 },
  { name: '960x540-tv-at-200', width: 960, height: 540 },
  { name: '768x614-laptop-at-167', width: 768, height: 614 },
];

let app: ElectronApplication;
let page: Page;
const problems: string[] = [];

function watchForProblems(target: Page) {
  target.on('console', (message) => {
    // Art that can't be had is a normal case with its own look. The browser logs it either way.
    if (message.type() === 'error' && !message.location().url.startsWith('art://')) {
      problems.push(`${test.info().title}: ${message.text()}`);
    }
  });
  target.on('pageerror', (error) => problems.push(`${test.info().title}: ${error.message}`));
}

async function value<T>(name: string, input?: unknown, on: Page = page): Promise<T> {
  const result = (await on.evaluate(
    ([command, args]) =>
      (window.api.invoke as (...values: unknown[]) => Promise<unknown>)(command, ...(args === undefined ? [] : [args])),
    [name, input] as const,
  )) as { ok: true; value: T } | { ok: false; error: { message: string } };
  if (!result.ok) throw new Error(`${name}: ${result.error.message}`);
  return result.value;
}

const state = (on: Page = page) => value<PlayerState>('player.state', undefined, on);
const position = () => value<PlayerPosition>('player.position');

function until(check: (current: PlayerState) => boolean, on: Page = page) {
  return expect.poll(async () => check(await state(on)), { timeout: 20_000, intervals: [25] }).toBe(true);
}

const untilStatus = (status: PlayerState['status'], on: Page = page) =>
  until((current) => current.status === status, on);

function tab(name: string) {
  return page.getByRole('tab', { name, exact: true });
}

function row(title: string) {
  return page.getByTestId('list-row').filter({ hasText: title }).first();
}

const transport = () => page.getByTestId('transport');
const elapsed = () => page.getByTestId('elapsed');
const seekbar = () => page.getByRole('slider', { name: 'Seek' });
const seekFill = () => page.getByTestId('seekbar').locator('[data-slot="fill"]');

async function seekBox(): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.getByTestId('seekbar').boundingBox();
  if (!box) throw new Error('No seekbar');
  return box;
}

function clockSeconds(text: string | null): number {
  const parts = (text ?? '').split(' / ')[0]!.split(':').map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

async function elapsedSeconds(): Promise<number> {
  return clockSeconds(await elapsed().textContent());
}

async function waitForIdleScan(on: Page = page): Promise<void> {
  await expect
    .poll(async () => (await value<ScanState>('scan.state', undefined, on)).phase, {
      timeout: 120_000,
      intervals: [100],
    })
    .toBe('idle');
}

/** How much of the line is filled, between 0 and 1, read from what's painted, so a stale one would show. */
function fillFraction(): Promise<number> {
  return seekFill().evaluate((fill) => new DOMMatrix(getComputedStyle(fill).transform).a);
}

/** Whether the bars in the current row change over a moment. */
function barsMove(): Promise<boolean> {
  return page
    .locator('[data-testid="playing-bars"] > span')
    .first()
    .evaluate(async (bar) => {
      const before = getComputedStyle(bar).transform;
      await new Promise((resolve) => setTimeout(resolve, 300));
      return getComputedStyle(bar).transform !== before;
    });
}

/** How often the line was written to over a second. */
function paintsInASecond(): Promise<number> {
  return seekFill().evaluate(async (fill) => {
    let paints = 0;
    const observer = new MutationObserver(() => {
      paints++;
    });
    observer.observe(fill, { attributes: true, attributeFilter: ['style'] });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    observer.disconnect();
    return paints;
  });
}

async function album(title: string): Promise<void> {
  await tab('Albums').click();
  await page.getByRole('searchbox').fill(title);
  await page.getByTestId('list-row').filter({ hasText: title }).first().click();
  await expect(page.locator('header h1')).toHaveText(title);
}

/** A toast from the test before can sit on top of what's about to be touched. */
async function dismissToasts(): Promise<void> {
  const dismiss = page.getByRole('button', { name: 'Dismiss' });
  while ((await dismiss.count()) > 0) {
    // One can time out by itself between the count and the click.
    await dismiss
      .first()
      .click({ timeout: 1_000 })
      .catch(() => {});
  }
}

/** Finger events, which Playwright only offers on a page it made with touch turned on. */
async function touch(): Promise<CDPSession> {
  return page.context().newCDPSession(page);
}

async function centerOf(locator: ReturnType<Page['locator']>): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('It has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function tap(session: CDPSession, at: { x: number; y: number }, holdMs = 30): Promise<void> {
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
  await page.waitForTimeout(holdMs);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(300_000);
  rmSync(E2E, { recursive: true, force: true });
  mkdirSync(SCREENSHOTS, { recursive: true });
  await generatedLibrary(MUSIC);

  app = await launchApp({ userData: join(E2E, 'user-data'), dataRoot: join(E2E, 'data') });
  page = await app.firstWindow();
  watchForProblems(page);
  await page.waitForLoadState('load');
  await resizeWindow(app, page, 1280, 800);

  await stubFolderDialog(app, MUSIC);
  await page.getByRole('button', { name: 'Choose a folder' }).click();
  await page.getByRole('tab', { name: 'Albums', exact: true }).click();
  await tab('Albums').waitFor();
  await waitForIdleScan();
});

test.afterAll(async () => {
  await app.close();
});

test('with nothing played yet, it is quiet: one small line, and controls that wait', async () => {
  await expect(page.getByTestId('art').getByText('Nothing playing')).toBeVisible();
  await expect(page.getByTestId('art').locator('h1')).toHaveCount(0);
  await expect(page.getByTestId('art').locator('img')).toHaveCount(0);
  await expect(transport().getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
  await expect(transport().getByRole('button', { name: 'Next' })).toBeDisabled();
  await expect(transport().getByRole('button', { name: 'Previous' })).toBeDisabled();
  expect(await seekbar().count()).toBe(1);
  await page.screenshot({ path: join(SCREENSHOTS, 'idle-1280x800.png') });
});

test('one click picks a row and two play it, with the list as the queue', async () => {
  await album('Field Recordings');
  const third = page.getByTestId('list-row').nth(2);
  const title = (await third.locator('span').filter({ hasNotText: /^\d/ }).first().textContent()) ?? '';

  await third.click();
  await page.waitForTimeout(150);
  expect((await state()).status).toBe('idle');
  expect(await third.evaluate((element) => element === document.activeElement)).toBe(true);

  await third.dblclick();
  await untilStatus('playing');
  const playing = await state();
  expect(playing.queueLength).toBe(30);
  expect(playing.queueIndex).toBe(2);
  expect(playing.current?.title).toBe(title.replace(/\d+:\d+$/, '').trim());

  await expect(page.getByTestId('now-playing-title')).toHaveText(playing.current?.title ?? '');
  await expect(page.getByTestId('now-playing-details')).toHaveText('Low Meadow · Field Recordings');
  await expect(page.getByTestId('art').locator('img')).toHaveAttribute('src', /^art:\/\/full\/[0-9a-f]{40}$/);
});

test('the time reads elapsed over total, and what is under the title goes to its page', async () => {
  await expect(elapsed()).toHaveText(/^\d+:\d\d \/ \d+:\d\d$/);
  await expect(page.getByTestId('remaining')).toHaveCount(0);

  const details = page.getByTestId('now-playing-details');
  const link = details.getByRole('button', { name: 'Low Meadow' });
  expect(await link.evaluate((element) => getComputedStyle(element).cursor)).toBe('pointer');
  const underlined = () =>
    link
      .locator('span')
      .first()
      .evaluate((element) => getComputedStyle(element).textDecorationLine);
  expect(await underlined()).toBe('none');
  await link.hover();
  expect(await underlined()).toBe('underline');

  // Too small for a finger by itself, so anything that could be one gets a bigger target.
  const target = await link.evaluate((element) => ({
    isCoarse: matchMedia('(any-pointer: coarse)').matches,
    height: parseFloat(getComputedStyle(element, '::after').height),
  }));
  if (target.isCoarse) expect(target.height).toBeGreaterThanOrEqual(44);

  const before = await details.boundingBox();
  await link.click();
  await expect(page.getByRole('heading', { name: 'Low Meadow', level: 1 })).toBeVisible();
  await details.getByRole('button', { name: 'Field Recordings' }).click();
  await expect(page.getByRole('heading', { name: 'Field Recordings', level: 1 })).toBeVisible();
  expect(await details.boundingBox()).toEqual(before);

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Low Meadow', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Low Meadow', level: 1 })).toHaveCount(0);
});

test('the position moves on screen, between the reports too, and agrees with main', async () => {
  await page.waitForTimeout(1_200);
  const before = await fillFraction();
  const shownAt = await elapsedSeconds();
  await page.waitForTimeout(1_500);
  expect(await fillFraction()).toBeGreaterThan(before);
  expect(await elapsedSeconds()).toBeGreaterThan(shownAt);

  const truth = (await position()).positionMs / 1000;
  expect(Math.abs((await elapsedSeconds()) - truth)).toBeLessThan(1.5);

  // These tracks run from 90 seconds to six and a half minutes, so the line has a step to make a few times a second.
  const paints = await paintsInASecond();
  expect(paints).toBeGreaterThanOrEqual(2);
  expect(paints).toBeLessThanOrEqual(5);
});

test('the bars run on the compositor, each its own way, and only in the current row', async () => {
  await expect(page.getByTestId('playing-bars')).toHaveCount(1);
  const animations = await page.getByTestId('playing-bars').evaluate((bars) =>
    [...bars.children].map((bar) => {
      const [animation] = bar.getAnimations();
      const timing = animation?.effect?.getTiming();
      const animated = animation?.effect instanceof KeyframeEffect ? animation.effect.getKeyframes() : [];
      return {
        name: animation instanceof CSSAnimation ? animation.animationName : null,
        duration: timing?.duration,
        delay: timing?.delay,
        running: animation?.playState === 'running',
        onlyTransform: animated.every(({ transform }) => String(transform).startsWith('scaleY')),
      };
    }),
  );
  expect(animations.every(({ running, onlyTransform }) => running && onlyTransform)).toBe(true);
  expect(new Set(animations.map(({ name }) => name)).size).toBe(3);
  expect(new Set(animations.map(({ duration }) => duration)).size).toBe(3);
  expect(new Set(animations.map(({ delay }) => delay)).size).toBe(3);

  // Their frames are the compositor's: the page writes nothing for them.
  const writes = await page.evaluate(async () => {
    let seen = 0;
    const observer = new MutationObserver((records) => {
      seen += records.filter(
        ({ target }) => target instanceof Element && target.closest('[data-testid="playing-bars"]'),
      ).length;
    });
    observer.observe(document.body, { subtree: true, attributes: true });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    observer.disconnect();
    return seen;
  });
  expect(writes).toBe(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.getByTestId('playing-bars').evaluate((bars) => bars.getAnimations({ subtree: true }).length)).toBe(
    0,
  );
  await page.emulateMedia({ reducedMotion: null });
});

test('the current row is marked in whichever list is showing, and only that one', async () => {
  const current = (await state()).current as Track;
  const marked = page.locator('[data-testid="list-row"][aria-current="true"]');
  await expect(marked).toHaveCount(1);
  await expect(marked).toContainText(current.title);
  await expect(marked.getByTestId('playing-bars')).toBeVisible();

  await page.getByRole('searchbox').fill(current.title);
  await expect(marked).toContainText(current.title);
  await page.getByRole('searchbox').fill('');

  await tab('Tracks').click();
  await page.getByTestId('list-row').first().waitFor();
  await page.getByTestId('list-scroller').evaluate((element) => {
    element.scrollTop = 0;
  });
  await tab('Albums').click();
});

test('pauses and resumes, and the bars and the clock stop with it', async () => {
  await album('Field Recordings');
  await expect.poll(barsMove).toBe(true);

  await transport().getByRole('button', { name: 'Pause' }).click();
  await untilStatus('paused');
  await expect.poll(barsMove).toBe(false);
  const pausedAt = await fillFraction();
  const shown = await elapsedSeconds();
  await page.waitForTimeout(700);
  expect(await fillFraction()).toBe(pausedAt);
  expect(await elapsedSeconds()).toBe(shown);

  await transport().getByRole('button', { name: 'Play', exact: true }).click();
  await untilStatus('playing');
  await expect.poll(barsMove).toBe(true);
  await expect.poll(fillFraction).toBeGreaterThan(pausedAt);
});

test('nothing moves in a hidden window, and it catches up when it comes back', async () => {
  await sendEvent(app, 'window.state', { isFullscreen: false, isMiniPlayer: false, isHidden: true });
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-window-hidden'));

  await expect.poll(barsMove).toBe(false);
  const before = await fillFraction();
  // Nothing is written at all: not by a frame, and not by a report from main.
  expect(await paintsInASecond()).toBe(0);
  expect(before).toBeGreaterThan(0);

  await sendEvent(app, 'window.state', { isFullscreen: false, isMiniPlayer: false, isHidden: false });
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-window-hidden'));
  await expect.poll(barsMove).toBe(true);
  await expect.poll(fillFraction).toBeGreaterThan(before);
});

test('seeks by keyboard, optimistically, with the arrows, Page keys, Home and End', async () => {
  await seekbar().focus();
  await page.keyboard.press('Home');
  await expect.poll(async () => (await position()).positionMs).toBeLessThan(2_000);

  const from = (await position()).positionMs;
  await page.keyboard.press('ArrowRight');
  // There before the next frame: it doesn't wait for main.
  expect(await elapsedSeconds()).toBeGreaterThanOrEqual(4);
  await expect.poll(async () => (await position()).positionMs).toBeGreaterThan(from + 4_000);

  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await position()).positionMs).toBeGreaterThan(from + 34_000);
  await page.keyboard.press('PageDown');
  await expect.poll(async () => (await position()).positionMs).toBeLessThan(from + 12_000);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await position()).positionMs).toBeLessThan(from + 7_000);

  // Alt+Left goes back, as it does anywhere else, and doesn't move the song.
  const before = (await position()).positionMs;
  await page.keyboard.press('Alt+ArrowLeft');
  await expect.poll(async () => (await position()).positionMs).toBeGreaterThan(before);
  await expect(page.locator('header h1')).toBeHidden();
  await expect(page.getByRole('searchbox')).toHaveValue('Field Recordings');

  await expect(seekbar()).toHaveAttribute('aria-valuetext', /^\d+:\d\d of \d+:\d\d$/);
});

test('a focused seekbar shows a whole ring, so it can be found from the couch', async () => {
  await seekbar().focus();
  await page.keyboard.press('ArrowRight');
  const dot = page.getByTestId('seekbar').locator('[data-slot="dot"]');
  await expect.poll(() => dot.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
  const outline = await dot.evaluate((element) => {
    const { outlineWidth, outlineStyle } = getComputedStyle(element);
    return { width: Number.parseFloat(outlineWidth), style: outlineStyle };
  });
  expect(outline.width).toBeGreaterThanOrEqual(2);
  expect(outline.style).toBe('solid');
  await page.screenshot({ path: join(SCREENSHOTS, 'seekbar-focus-1280x800.png') });
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
});

test('a click on the bar seeks there, and a drag ignores the song until it lets go', async () => {
  const bar = await seekBox();
  const y = bar.y + 12;
  const { durationMs } = await state();

  await page.mouse.click(bar.x + bar.width * 0.5, y);
  await expect.poll(async () => Math.abs((await position()).positionMs / durationMs - 0.5)).toBeLessThan(0.02);
  await expect.poll(async () => Math.abs((await fillFraction()) - 0.5)).toBeLessThan(0.02);

  await page.mouse.move(bar.x + bar.width * 0.25, y);
  await page.mouse.down();
  await page.mouse.move(bar.x + bar.width * 0.75, y);
  const whileDragging = await fillFraction();
  expect(Math.abs(whileDragging - 0.75)).toBeLessThan(0.01);
  // Main is still somewhere around the middle, and its reports keep coming.
  await page.waitForTimeout(700);
  expect(await fillFraction()).toBe(whileDragging);
  expect(Math.abs((await position()).positionMs / durationMs - 0.5)).toBeLessThan(0.05);

  // All the way off the end, in one move.
  await page.mouse.move(bar.x + bar.width * 0.1, y);
  await page.mouse.move(bar.x - 50, y);
  expect(await fillFraction()).toBe(0);
  await page.mouse.move(bar.x + bar.width * 0.75, y);
  await page.mouse.up();
  await expect.poll(async () => Math.abs((await position()).positionMs / durationMs - 0.75)).toBeLessThan(0.02);
});

test('a right-click on a seekbar does not seek', async () => {
  const before = (await position()).positionMs;
  const bar = await seekBox();
  await page.mouse.click(bar.x + bar.width * 0.05, bar.y + 12, { button: 'right' });
  await page.waitForTimeout(200);
  expect((await position()).positionMs).toBeGreaterThanOrEqual(before);
});

test('next and previous move through the queue, and the art follows without a flash', async () => {
  await album('Complete Recordings');
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await until((current) => current.status === 'playing' && current.current?.album === 'Complete Recordings');
  expect((await state()).queueIndex).toBe(0);

  await transport().getByRole('button', { name: 'Next' }).click();
  await until((current) => current.queueIndex === 1 && current.status === 'playing');

  await transport().getByRole('button', { name: 'Previous' }).click();
  await until((current) => current.queueIndex === 0 && current.status === 'playing');

  // More than three seconds in, Previous starts the track over.
  await seekbar().focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await position()).positionMs).toBeGreaterThan(5_000);
  await transport().getByRole('button', { name: 'Previous' }).click();
  await expect.poll(async () => (await position()).positionMs).toBeLessThan(3_000);
  expect((await state()).queueIndex).toBe(0);
});

test('art never shows half an image: it only goes in decoded, and the old stays under it', async () => {
  // Watches every image as it's added to the pane, from the moment it's added.
  await page.evaluate(() => {
    const seen: { complete: boolean; width: number }[] = [];
    Object.assign(window, { artSeen: seen });
    const pane = document.querySelector('[data-testid="now-playing"]') as HTMLElement;
    new MutationObserver((changes) => {
      for (const change of changes) {
        for (const node of change.addedNodes) {
          const image = node instanceof HTMLElement ? node.querySelector('img') : null;
          if (image) seen.push({ complete: image.complete, width: image.naturalWidth });
        }
      }
    }).observe(pane, { childList: true, subtree: true });
  });

  const tracks = await value<Track[]>('library.tracks', { filter: { kind: 'all' } });
  const withArt = tracks.filter(({ artHash }) => artHash !== null);
  const hashes = [...new Set(withArt.map(({ artHash }) => artHash))];
  for (const hash of hashes.slice(0, 4)) {
    const track = withArt.find(({ artHash }) => artHash === hash) as Track;
    await value('player.play', { trackIds: [track.id], startIndex: 0 });
    await expect(page.getByTestId('art').locator('img').last()).toHaveAttribute('src', `art://full/${hash}`);
    await page.waitForTimeout(450);
    await expect(page.getByTestId('art').locator('img')).toHaveCount(1);
  }

  const seen = await page.evaluate(
    () => (window as unknown as { artSeen: { complete: boolean; width: number }[] }).artSeen,
  );
  expect(seen.length).toBeGreaterThanOrEqual(3);
  for (const image of seen) expect(image.complete && image.width > 0, JSON.stringify(image)).toBe(true);
});

test('the crossfade really fades, over about 300 ms', async () => {
  const tracks = await value<Track[]>('library.tracks', { filter: { kind: 'all' } });
  const byArt = new Map(tracks.filter(({ artHash }) => artHash !== null).map((track) => [track.artHash, track]));
  const [first, second] = [...byArt.values()] as [Track, Track];
  await value('player.play', { trackIds: [first.id], startIndex: 0 });
  await expect(page.getByTestId('art').locator('img').last()).toHaveAttribute('src', `art://full/${first.artHash}`);
  await page.waitForTimeout(400);

  const opacities = await page.evaluate(async (id) => {
    const pane = document.querySelector('[data-testid="now-playing"] button > span > span') as HTMLElement;
    void window.api.invoke('player.play', { trackIds: [id], startIndex: 0 });
    const samples: { layers: number; top: number; at: number }[] = [];
    const started = performance.now();
    await new Promise<void>((done) => {
      const step = () => {
        const top = pane.lastElementChild;
        samples.push({
          layers: pane.childElementCount,
          top: top ? Number(getComputedStyle(top).opacity) : 1,
          at: performance.now() - started,
        });
        if (performance.now() - started < 1_000) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });
    return samples;
  }, second.id);

  // Two layers, or three if the last fade hadn't quite finished on a busy machine.
  const fading = opacities.filter(({ layers, top }) => layers >= 2 && top < 1);
  expect(fading.length, JSON.stringify(opacities)).toBeGreaterThan(3);
  const lasted = (fading.at(-1)?.at ?? 0) - (fading[0]?.at ?? 0);
  expect(lasted).toBeGreaterThan(150);
  expect(lasted).toBeLessThan(450);
  expect(opacities.at(-1)).toMatchObject({ layers: 1, top: 1 });
});

test('under reduced motion the art just changes', async () => {
  const tracks = await value<Track[]>('library.tracks', { filter: { kind: 'all' } });
  const byArt = new Map(tracks.filter(({ artHash }) => artHash !== null).map((track) => [track.artHash, track]));
  const [first, second] = [...byArt.values()] as [Track, Track];
  await page.emulateMedia({ reducedMotion: 'reduce' });
  try {
    await value('player.play', { trackIds: [first.id], startIndex: 0 });
    await expect(page.getByTestId('art').locator('img').last()).toHaveAttribute('src', `art://full/${first.artHash}`);
    await page.waitForTimeout(100);

    const frames = await page.evaluate(async (id) => {
      const pane = document.querySelector('[data-testid="now-playing"] button > span > span') as HTMLElement;
      void window.api.invoke('player.play', { trackIds: [id], startIndex: 0 });
      const seen: { layers: number; opacity: string; src: string | null }[] = [];
      const started = performance.now();
      await new Promise<void>((done) => {
        const step = () => {
          seen.push({
            layers: pane.childElementCount,
            opacity: getComputedStyle(pane.lastElementChild as Element).opacity,
            src: pane.querySelector('img')?.getAttribute('src') ?? null,
          });
          if (performance.now() - started < 500) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      });
      return seen;
    }, second.id);
    expect(
      frames.every(({ layers, opacity }) => layers === 1 && opacity === '1'),
      JSON.stringify(frames),
    ).toBe(true);
    expect(frames.at(-1)?.src).toBe(`art://full/${second.artHash}`);
  } finally {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  }
});

test('the accent follows the album, and eases there', async () => {
  const accent = () =>
    page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  const tracks = await value<Track[]>('library.tracks', { filter: { kind: 'all' } });
  const colored = tracks.filter(({ artColor }) => artColor !== null);
  const [first, second] = [...new Map(colored.map((track) => [track.artColor, track])).values()];

  await value('player.play', { trackIds: [first?.id], startIndex: 0 });
  await page.waitForTimeout(800);
  const settledOn = await accent();

  await value('player.play', { trackIds: [second?.id], startIndex: 0 });
  await until((current) => current.current?.id === second?.id);
  await page.waitForTimeout(100);
  const midway = await accent();
  await page.waitForTimeout(800);
  const next = await accent();

  expect(next).not.toBe(settledOn);
  expect(midway).not.toBe(settledOn);
  expect(midway).not.toBe(next);

  // The list's wash and the fill both come from it.
  expect(await seekFill().evaluate((fill) => getComputedStyle(fill).backgroundColor)).toBe(next);
});

test('an album with no art gets the sleeve, with its title large, and the neutral accent', async () => {
  await album('Bare Sleeve');
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await until((current) => current.current?.album === 'Bare Sleeve' && current.status === 'playing');

  const sleeve = page.getByTestId('art').locator('[style*="--art-hue"]');
  await expect(sleeve).toContainText('Bare Sleeve');
  await expect(page.getByTestId('art').locator('img')).toHaveCount(0, { timeout: 2_000 });
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()))
    .toBe('rgb(212, 212, 212)');
  await page.screenshot({ path: join(SCREENSHOTS, 'no-art-1280x800.png') });
});

test('the Queue tab shows the queue, marks the current place, and plays any row', async () => {
  await album('Complete Recordings');
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await until((current) => current.current?.album === 'Complete Recordings');

  await tab('Queue').click();
  const rows = page.getByTestId('list-row');
  await rows.first().waitFor();
  const queue = await value<QueueItem[]>('player.queue');
  expect(queue).toHaveLength(18);
  await expect(page.getByText('18 tracks')).toBeVisible();
  await expect(rows.first()).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('[data-testid="list-row"][aria-current="true"]')).toHaveCount(1);

  await rows.nth(4).dblclick();
  await until((current) => current.queueIndex === 4 && current.status === 'playing');
  await expect(rows.nth(4)).toHaveAttribute('aria-current', 'true');
  await expect(rows.first()).not.toHaveAttribute('aria-current', 'true');
  await page.screenshot({ path: join(SCREENSHOTS, 'queue-1280x800.png') });
});

test('the same track twice in the queue only marks the one that is current', async () => {
  const { current } = await state();
  await value('player.enqueue', { trackIds: [current?.id], where: 'next' });
  await expect(page.getByText('19 tracks')).toBeVisible();
  await expect(page.locator('[data-testid="list-row"][aria-current="true"]')).toHaveCount(1);
  await expect(page.getByTestId('list-row').nth(4)).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('list-row').nth(5)).not.toHaveAttribute('aria-current', 'true');
});

test('the menu on a queue row moves and removes it', async () => {
  const rows = page.getByTestId('list-row');
  const queueTitles = async () => (await value<QueueItem[]>('player.queue')).map(({ track }) => track.title);
  const before = await queueTitles();

  await rows.nth(7).click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(SCREENSHOTS, 'queue-menu-1280x800.png') });
  await page.getByRole('menuitem', { name: 'Move up' }).click();
  await expect.poll(queueTitles).toEqual([...before.slice(0, 6), before[7], before[6], ...before.slice(8)]);

  const moved = await queueTitles();
  await rows.nth(6).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move down' }).click();
  await expect.poll(queueTitles).toEqual(before);
  expect(moved).not.toEqual(before);

  await rows.nth(7).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Remove from queue' }).click();
  await expect.poll(async () => (await queueTitles()).length).toBe(before.length - 1);
  // What's playing doesn't notice any of that.
  expect((await state()).status).toBe('playing');
});

test('Clear empties the queue and stops, and the empty queue has a next step', async () => {
  await transport().hover();
  await page.getByRole('button', { name: 'Clear' }).click();
  await untilStatus('idle');
  await expect(page.getByText('Nothing queued')).toBeVisible();
  await expect(page.getByTestId('art').getByText('Nothing playing')).toBeVisible();

  await page.getByRole('button', { name: 'Browse albums' }).click();
  await expect(tab('Albums')).toHaveAttribute('aria-selected', 'true');
});

test('the menu on a track row plays it, or adds it next or last, and a card has no such menu', async () => {
  const card = page.getByTestId('album-card').first();
  await card.click({ button: 'right' });
  await page.waitForTimeout(150);
  await expect(page.getByRole('menu')).toHaveCount(0);

  await album('Homogénic');
  const rows = page.getByTestId('list-row');
  await rows.nth(1).click({ button: 'right' });
  await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText([
    'Play',
    'Play next',
    'Add to queue',
    'Add to playlist',
    'Reveal in File Explorer',
  ]);
  await page.getByRole('menuitem', { name: 'Play', exact: true }).click();
  await until((current) => current.current?.title === 'Hunter' && current.queueLength === 4);

  await rows.nth(3).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Play next' }).click();
  await expect
    .poll(async () => (await value<QueueItem[]>('player.queue')).map(({ track }) => track.title))
    .toEqual(['Jóga', 'Hunter', 'Unravel', 'Bachelorette', 'Unravel']);
  await expect(page.getByText('Playing next: Unravel', { exact: true })).toBeVisible();

  await rows.nth(0).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Add to queue' }).click();
  await expect
    .poll(async () => (await value<QueueItem[]>('player.queue')).map(({ track }) => track.title))
    .toEqual(['Jóga', 'Hunter', 'Unravel', 'Jóga', 'Bachelorette', 'Unravel']);
});

test('a toast that lands on an open menu takes the first Escape, and the second closes the menu', async () => {
  await album('Homogénic');
  await page.getByTestId('list-row').first().click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();

  await app.evaluate(({ BrowserWindow }) => {
    const notice = { id: 9_002, level: 'info', message: 'A toast on a menu', action: null };
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('event:notice', notice);
  });
  const toast = page.getByText('A toast on a menu', { exact: true });
  await expect(toast).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(toast).toBeHidden();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.locator('header h1')).toHaveText('Homogénic');

  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.locator('header h1')).toHaveText('Homogénic');
});

test("the art pane's focus ring is the same on every album, and doesn't use the album's color", async () => {
  const tracks = await value<Track[]>('library.tracks', { filter: { kind: 'all' } });
  const withArt = tracks.find(({ artHash }) => artHash !== null) as Track;
  await value('player.play', { trackIds: [withArt.id], startIndex: 0 });
  await expect(page.getByTestId('art').locator('img').last()).toBeVisible();

  await page.keyboard.press('Shift');
  const pane = page.getByTestId('now-playing').getByRole('button', { name: 'Lyrics' });
  await pane.focus();
  const ring = await pane.evaluate((button) => {
    const probe = document.createElement('div');
    probe.style.color = 'var(--color-neutral-50)';
    probe.style.outlineColor = 'var(--color-neutral-950)';
    document.body.append(probe);
    const wanted = getComputedStyle(probe);
    const shadow = getComputedStyle(button, '::after').boxShadow;
    const found = {
      isFocused: button.matches(':focus-visible'),
      light: shadow.includes(wanted.color),
      dark: shadow.includes(wanted.outlineColor),
    };
    probe.remove();
    return found;
  });
  expect(ring).toEqual({ isFocused: true, light: true, dark: true });
  await page.screenshot({ path: join(SCREENSHOTS, 'focus-art.png'), animations: 'disabled' });
  await pane.blur();
});

test('the menu key opens it for the row with focus, and Escape closes it without going back', async () => {
  await album('Homogénic');
  const rows = page.getByTestId('list-row');
  await rows.first().click();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.locator('header h1')).toHaveText('Homogénic');
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.closest('[data-index]')?.getAttribute('data-index')))
    .toBe('1');
});

test('Enter plays from the keyboard', async () => {
  await page.keyboard.press('Enter');
  await until(
    (current) => current.current?.title === 'Hunter' && current.queueIndex === 1 && current.queueLength === 4,
  );
});

test('a finger plays with one tap, and a long press opens the menu without playing', async () => {
  await album('Late Night Tapes');
  await dismissToasts();
  const session = await touch();
  const rows = page.getByTestId('list-row');

  await tap(session, await centerOf(rows.nth(2)));
  await until((current) => current.current?.album === 'Late Night Tapes' && current.queueIndex === 2);

  await value('player.pause');
  await untilStatus('paused');
  const { loadId } = await state();
  await tap(session, await centerOf(rows.nth(4)), 900);
  await expect(page.getByRole('menu')).toBeVisible();
  await page.waitForTimeout(200);
  const after = await state();
  expect(after.loadId).toBe(loadId);
  expect(after.queueIndex).toBe(2);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await session.detach();
  await value('player.resume');
});

test('search results play too, and the menu gets to the album', async () => {
  await page.getByRole('searchbox').fill('Bachelorette');
  const found = page.getByTestId('list-row').filter({ hasText: 'Bachelorette' });
  await found.first().dblclick();
  await until((current) => current.current?.title === 'Bachelorette' && current.status === 'playing');

  await found.first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Go to album' }).click();
  await expect(page.locator('header h1')).toHaveText('Homogénic');
  await tab('Albums').click();
});

test('an artist and a genre can be played whole, in the order the list shows', async () => {
  await tab('Artists').click();
  await page.getByTestId('list-row').filter({ hasText: 'Björk' }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await until((current) => current.queueLength === 4 && current.current?.artist === 'Björk');

  await tab('Genres').click();
  await page.getByTestId('list-row').filter({ hasText: 'J-Pop' }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await until((current) => current.queueLength === 4 && current.current?.artist === '東京事変');
  await tab('Albums').click();
});

test('the end of the queue keeps the art and a full line, and play starts it over', async () => {
  await album('Bare Sleeve');
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await until((current) => current.current?.album === 'Bare Sleeve' && current.status === 'playing');
  const { queueLength } = await state();
  await value('player.playQueueIndex', { index: queueLength - 1 });
  await until((current) => current.queueIndex === queueLength - 1 && current.status === 'playing');

  const { current } = await state();
  await seekbar().focus();
  await page.keyboard.press('End');
  await untilStatus('ended');

  await expect(page.getByTestId('art').locator('[style*="--art-hue"]')).toContainText('Bare Sleeve');
  await expect(page.getByTestId('now-playing-title')).toHaveText(current?.title ?? '');
  await expect.poll(fillFraction).toBe(1);
  await expect(elapsed()).toHaveText(/^(.+) \/ \1$/);
  await page.screenshot({ path: join(SCREENSHOTS, 'ended-1280x800.png') });

  // A click on the line opens the last track again from there.
  const bar = await seekBox();
  await page.mouse.click(bar.x + bar.width * 0.5, bar.y + 12);
  await untilStatus('playing');
  await expect.poll(async () => Math.abs((await fillFraction()) - 0.5)).toBeLessThan(0.05);
  await seekbar().focus();
  await page.keyboard.press('End');
  await untilStatus('ended');

  await transport().getByRole('button', { name: 'Play', exact: true }).click();
  await until((next) => next.status === 'playing' && next.queueIndex === 0);
  await expect.poll(fillFraction).toBeLessThan(0.1);
  await tab('Albums').click();
});

test('the volume and mute work from the transport, and the slider says what they did', async () => {
  const volume = page.getByRole('slider', { name: 'Volume' });
  await volume.focus();
  await page.keyboard.press('Home');
  await expect.poll(async () => (await state()).volume).toBe(0);
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await state()).volume).toBe(1);
  await page.keyboard.press('End');
  await expect.poll(async () => (await state()).volume).toBe(100);

  await page.getByRole('button', { name: 'Mute' }).click();
  await expect.poll(async () => (await state()).muted).toBe(true);
  await expect(page.getByRole('button', { name: 'Unmute' })).toHaveAttribute('aria-pressed', 'true');

  // Reaching for the volume means wanting to hear it.
  await volume.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await state()).muted).toBe(false);
  await expect.poll(async () => (await state()).volume).toBe(99);
  await page.keyboard.press('End');

  const bar = await volume.locator('xpath=ancestor::*[@data-orientation="horizontal"][1]').boundingBox();
  if (!bar) throw new Error('No volume bar');
  await page.mouse.click(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await expect.poll(async () => Math.abs((await state()).volume - 50)).toBeLessThan(5);
  await page.keyboard.press('End');
  await expect.poll(async () => (await state()).volume).toBe(100);
});

test('the signal line says what is happening, and the whole of it is a tap away', async () => {
  await value('player.setReplayGainMode', { mode: 'off' });
  const status = page.getByTestId('signal-status').locator('visible=true');
  await expect(status).toContainText('kHz');
  await expect(status).toContainText('Windows is mixing');

  await dismissToasts();
  await status.click();
  await expect(page.getByTestId('signal-details')).toContainText('Windows is mixing');
  await expect(page.getByTestId('signal-details')).toContainText('From the file');
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(SCREENSHOTS, 'signal-details-1280x800.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('signal-details')).toHaveCount(0);
  await expect(status).toBeFocused();
});

test('the exclusive switch says what it does, and turns the signal bit-perfect', async () => {
  const exclusive = page.getByRole('switch', { name: /Exclusive/ }).locator('visible=true');
  await expect(exclusive).toHaveAccessibleName(/mutes other apps/);
  await expect(exclusive).toHaveAttribute('aria-checked', 'false');

  await exclusive.click();
  await expect.poll(async () => (await state()).outputMode).toBe('exclusive');
  await expect(exclusive).toHaveAttribute('aria-checked', 'true');
  const status = page.getByTestId('signal-status').locator('visible=true');
  await expect(status).toContainText('Bit-perfect');
  await page.screenshot({ path: join(SCREENSHOTS, 'bit-perfect-1280x800.png') });

  await page.getByRole('slider', { name: 'Volume' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(status).toContainText('Volume is below 100');
  await page.keyboard.press('End');
  await expect(status).toContainText('Bit-perfect');

  await exclusive.click();
  await expect.poll(async () => (await state()).outputMode).toBe('shared');
  await value('player.setReplayGainMode', { mode: 'album' });
});

test('Settings has ReplayGain, in plain words, and says what it reads', async () => {
  await openSettingsTab(page, 'Playback');
  const playback = page.getByTestId('settings').getByRole('region', { name: 'Playback' });
  await expect(playback).toContainText('foobar');
  await expect(playback.getByRole('radio', { name: 'Album' })).toHaveAttribute('aria-checked', 'true');

  await playback.getByRole('radio', { name: 'Track' }).click();
  await expect.poll(async () => (await state()).replayGainMode).toBe('track');
  await playback.getByRole('radio', { name: 'Off' }).click();
  await expect.poll(async () => (await state()).replayGainMode).toBe('off');
  // Pressing the one that's on leaves it on.
  await playback.getByRole('radio', { name: 'Off' }).click();
  await page.waitForTimeout(100);
  expect((await state()).replayGainMode).toBe('off');
  await playback.getByRole('radio', { name: 'Album' }).click();
  await expect.poll(async () => (await state()).replayGainMode).toBe('album');
});

test('Settings says each thing once: the count of issues, and Windows paths', async () => {
  await openSettingsTab(page, 'Library');
  const issues = page.getByTestId('scan-issues');
  await expect(issues).toContainText('2 files with issues');
  await expect(issues).toContainText('1 file · Tags are missing or damaged');
  await expect(issues).not.toContainText('1 file.');

  await page.getByRole('button', { name: 'Show the files' }).click();
  await expect(issues).toContainText('Broken\\corrupt.flac');
  await expect(issues).not.toContainText('Broken/corrupt.flac');
  await page.getByRole('button', { name: 'Hide the files' }).click();
});

test('a Dialog opens under the strict CSP, which logs nothing against it', async () => {
  rmSync(join(MUSIC, 'Björk', 'Homogénic', '1-02 Hunter.flac'));
  await page.getByRole('button', { name: 'Rescan' }).click();
  await waitForIdleScan();
  const missing = page.getByTestId('settings').getByRole('region', { name: 'Missing' });
  await expect(missing).toContainText('1 track in the library');
  await dismissToasts();

  await missing.getByRole('button', { name: 'Remove missing' }).click();
  const dialog = page.getByRole('dialog', { name: /^Remove/ });
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: join(SCREENSHOTS, 'dialog-1280x800.png') });
  await dialog.getByRole('button', { name: 'Keep them' }).click();
  await expect(dialog).toBeHidden();
  // The scroll lock's style tag: it has a hash in the CSP, and it says so here if an upgrade changes it.
  expect(problems).toEqual([]);
});

test('the Settings modal opens under the strict CSP too, with nothing blocked', async () => {
  await closeSettings(page);
  await page.evaluate(() => {
    const seen: string[] = [];
    Object.assign(window, { cspViolations: seen });
    document.addEventListener('securitypolicyviolation', ({ violatedDirective, sample }) => {
      seen.push(`${violatedDirective}: ${sample}`);
    });
  });
  await openSettingsTab(page, 'Library');
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations)).toEqual([]);
  expect(problems).toEqual([]);
});

test('a missing track is grey, says why, and can not be started from a click', async () => {
  const missing = page.getByTestId('settings').getByRole('region', { name: 'Missing' });
  await missing.getByRole('button', { name: 'Show them' }).click();
  await expect(page.locator('header h1')).toHaveText('Missing tracks');

  const hunter = row('Hunter');
  await expect(hunter).toContainText('Not on this device');
  await expect(hunter).toHaveAttribute('aria-disabled', 'true');
  expect(await hunter.evaluate((element) => Number(getComputedStyle(element).opacity))).toBeLessThan(0.6);

  const before = await state();
  await hunter.dispatchEvent('dblclick');
  await hunter.evaluate((element) => (element as HTMLElement).click());
  await page.waitForTimeout(150);
  expect((await state()).loadId).toBe(before.loadId);
  await page.getByRole('button', { name: 'Back' }).click();
});

test('a file that has gone is skipped with a Reveal, and shows greyed in the queue', async () => {
  await album('Field Recordings');
  const allTracks = await value<Track[]>('library.tracks', { filter: { kind: 'all' } });
  const inAlbum = allTracks.filter((track) => track.album === 'Field Recordings');
  const gone = inAlbum.toSorted((a, b) => (a.trackNumber ?? 0) - (b.trackNumber ?? 0))[0];
  if (!gone) throw new Error('No track');
  const path = join(MUSIC, ...gone.relPath.split('/'));
  renameSync(path, `${path}.hidden`);
  try {
    await page.getByTestId('list-row').first().dblclick();
    await until((current) => (current.queueIndex ?? 0) >= 1 && current.status === 'playing');
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible();
    await page.screenshot({ path: join(SCREENSHOTS, 'skipped-1280x800.png') });

    await tab('Queue').click();
    await expect(page.getByTestId('list-row').first()).toContainText('Not on this device');
    await page
      .getByTestId('list-row')
      .first()
      .evaluate((element) => (element as HTMLElement).click());
    await page.waitForTimeout(100);
    expect((await state()).queueIndex).not.toBe(0);
  } finally {
    renameSync(`${path}.hidden`, path);
  }
  await openSettingsTab(page, 'Library');
  await page.getByRole('button', { name: 'Rescan' }).click();
  await waitForIdleScan();
  await closeSettings(page);
  await tab('Albums').click();
});

test('everything fits and stays tappable at every window size, with at least 3 rows of list', async () => {
  await tab('Tracks').click();
  await page.getByTestId('list-row').first().waitFor();
  const tracks = await value<Track[]>('library.tracks', { filter: { kind: 'all' } });
  await value('player.play', { trackIds: [tracks[0]?.id], startIndex: 0 });
  await untilStatus('playing');
  // Longer than a path mpv can open, so these are told to the page instead. Nothing else changes while this test runs.
  const playing = await state();
  await sendEvent(app, 'player.state', {
    ...playing,
    current: {
      ...playing.current,
      title: 'A Track Whose Name Goes On For So Long That No Row Could Possibly Show All Of It Without An Ellipsis',
      artist: LONG_ARTIST_NAME,
      album: LONG_ALBUM_TITLE,
    },
  });
  await expect(page.getByTestId('now-playing-details')).toContainText(LONG_ALBUM_TITLE);
  await dismissToasts();

  for (const { name, width, height } of SIZES) {
    await resizeWindow(app, page, width, height);
    await page.waitForTimeout(150);
    await settled(page);
    await page.screenshot({ path: join(SCREENSHOTS, `playing-${name}.png`) });

    const measured = await page.evaluate(() => {
      const box = (element: Element) => {
        const { x, y, width: w, height: h } = element.getBoundingClientRect();
        return { x, y, width: w, height: h };
      };
      const isShown = (element: Element) => box(element).width > 0 && getComputedStyle(element).visibility !== 'hidden';
      const footer = box(document.querySelector('footer') as Element);
      const transport = document.querySelector('[data-testid="transport"]') as Element;
      return {
        window: { width: innerWidth, height: innerHeight },
        footer,
        scroller: box(document.querySelector('[data-testid="list-scroller"]') as Element),
        row: box(document.querySelector('[data-testid="list-row"]') as Element),
        art: box(document.querySelector('[data-testid="art"]') as Element),
        targets: [
          ...transport.querySelectorAll('button:not([data-testid="now-playing-details"] button), [role="slider"]'),
        ]
          .filter(isShown)
          .map((element) => ({
            name: element.getAttribute('aria-label') ?? element.textContent,
            role: element.getAttribute('role'),
            box: box(element),
            parent: box(element.closest('[aria-disabled], label') ?? element),
          })),
        overflowsX: document.documentElement.scrollWidth > innerWidth,
        transportOverflow: transport.scrollWidth > transport.clientWidth + 1,
      };
    });

    expect(measured.overflowsX, name).toBe(false);
    expect(measured.transportOverflow, name).toBe(false);
    expect(measured.footer.y + measured.footer.height, name).toBeCloseTo(measured.window.height, 0);
    expect(measured.art.width, name).toBeCloseTo(measured.art.height, 0);
    expect(measured.scroller.height / measured.row.height, `${name}: rows of list`).toBeGreaterThanOrEqual(3);

    for (const { name: target, role, box, parent } of measured.targets) {
      const label = `${name}: ${target}`;
      expect(box.x, label).toBeGreaterThanOrEqual(measured.footer.x - 1);
      expect(box.x + box.width, label).toBeLessThanOrEqual(measured.footer.x + measured.footer.width + 1);
      expect(box.y + box.height, label).toBeLessThanOrEqual(measured.window.height + 1);
      // A slider's or a switch's target is the whole of the control around it.
      const isWhole = role === 'slider' || role === 'switch';
      expect((isWhole ? parent : box).height, label).toBeGreaterThanOrEqual(44);
      if (!isWhole) expect(box.width, label).toBeGreaterThanOrEqual(44);
    }
  }
  await resizeWindow(app, page, 1280, 800);
});

test('it still fits with the interface size turned up or down, as far as each window lets it go', async () => {
  const setUiScale = async (uiScale: number) => {
    await value('settings.update', { uiScale });
    await page.waitForFunction(
      (scale) => document.documentElement.style.getPropertyValue('--ui-scale') === String(scale),
      uiScale,
    );
    await settled(page);
  };

  for (const [width, height] of [
    [1280, 800],
    [1920, 1080],
    [900, 1200],
    [768, 480],
    [640, 480],
  ] as const) {
    await resizeWindow(app, page, width, height);
    for (const uiScale of [0.75, 1.5, 2.25]) {
      await setUiScale(uiScale);
      const label = `${width}x${height} at ${uiScale}`;
      const measured = await page.evaluate(() => {
        const transport = document.querySelector('[data-testid="transport"]') as Element;
        const scroller = document.querySelector('[data-testid="list-scroller"]') as Element;
        const row = document.querySelector('[data-testid="list-row"]') as Element;
        return {
          overflows: transport.scrollWidth > transport.clientWidth + 1,
          rows: scroller.clientHeight / row.getBoundingClientRect().height,
          smallestButton: Math.min(
            ...[
              ...transport.querySelectorAll('button:not([role="switch"], [data-testid="now-playing-details"] button)'),
            ]
              .map((button) => button.getBoundingClientRect())
              .filter(({ width: shown }) => shown > 0)
              .map(({ height: tall }) => tall),
          ),
        };
      });
      expect(measured.overflows, label).toBe(false);
      expect(measured.smallestButton, label).toBeGreaterThanOrEqual(44);
      expect(measured.rows, label).toBeGreaterThanOrEqual(3);
    }
    await setUiScale(1);
  }
  await resizeWindow(app, page, 1280, 800);
});

test('the sound controls that fold away are still all there in the menu', async () => {
  await resizeWindow(app, page, 768, 480);
  await dismissToasts();
  await expect(page.getByRole('slider', { name: 'Volume' })).toBeHidden();
  await transport().getByRole('button', { name: 'Sound' }).click();
  const menu = page.getByRole('dialog', { name: 'Sound' });
  await expect(menu.getByRole('slider', { name: 'Volume' })).toBeVisible();
  await expect(menu.getByRole('switch', { name: /Exclusive/ })).toBeVisible();
  await expect(menu.getByTestId('signal-details')).toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(SCREENSHOTS, 'sound-menu-768x480.png') });
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await resizeWindow(app, page, 1280, 800);
});

test('killing mpv mid-play comes back at the same place, with nothing to say about it', async () => {
  const tracks = await value<Track[]>('library.tracks', { filter: { kind: 'all' } });
  await value('player.play', { trackIds: tracks.slice(0, 5).map(({ id }) => id), startIndex: 0 });
  await untilStatus('playing');
  await seekbar().focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await position()).positionMs).toBeGreaterThan(30_000);
  const { loadId } = await state();

  const electronPid = await app.evaluate(() => process.pid);
  const pids = execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "ParentProcessId=${electronPid} AND Name='mpv.exe'" | ForEach-Object { $_.ProcessId }`,
    ],
    { encoding: 'utf8', windowsHide: true },
  )
    .split(/\s+/)
    .filter(Boolean);
  expect(pids).toHaveLength(1);
  const shownBefore = await elapsedSeconds();
  execFileSync('taskkill', ['/F', '/PID', pids[0] as string], { windowsHide: true, stdio: 'ignore' });

  await until((current) => current.status === 'playing' && current.loadId > loadId);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.waitForTimeout(400);
  const shownAfter = await elapsedSeconds();
  expect(shownAfter).toBeGreaterThanOrEqual(shownBefore);
  expect(shownAfter).toBeLessThan(shownBefore + 5);
  await value('player.clearQueue');
  await untilStatus('idle');
});

test('a page reloaded mid-song comes back with the song, its art, its place and its accent', async () => {
  const tracks = await value<Track[]>('library.tracks', { filter: { kind: 'all' } });
  const withArt = tracks.find(({ artHash, artColor }) => artHash !== null && artColor !== null) as Track;
  await value('player.play', { trackIds: [withArt.id], startIndex: 0 });
  await untilStatus('playing');
  await value('player.seek', { positionMs: 30_000 });
  await value('player.pause');
  await untilStatus('paused');

  await page.reload();
  await page.getByTestId('now-playing-title').waitFor();
  await expect(page.getByTestId('now-playing-title')).toHaveText(withArt.title);
  await expect(elapsed()).toHaveText(/^0:30 \/ /);
  await expect(page.getByTestId('art').locator('img')).toHaveAttribute('src', `art://full/${withArt.artHash}`);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--accent')))
    .not.toBe('');
  await value('player.clearQueue');
  await untilStatus('idle');
});

test('the last scan report is still there after a relaunch', async () => {
  await app.close();
  app = await launchApp({ userData: join(E2E, 'user-data'), dataRoot: join(E2E, 'data') });
  page = await app.firstWindow();
  watchForProblems(page);
  await page.waitForLoadState('load');
  await tab('Albums').waitFor();

  await openSettingsTab(page, 'Library');
  await expect(page.getByTestId('scan-report')).toBeVisible();
  await expect(page.getByTestId('scan-report')).toContainText(/took \d/);
  await closeSettings(page);
});

test('nothing logged an error along the way', () => {
  expect(problems).toEqual([]);
});

// The rest start the app with a failing engine or device. Still silent: the PCM writer can't open its file, and a bad
// option never gets as far as any output.
test.describe('when the device fails', () => {
  let failing: ElectronApplication;
  let failingPage: Page;

  test.afterEach(async () => {
    await failing.close();
  });

  test('exclusive falls back to shared with a toast, and shared failing says so with Retry', async () => {
    failing = await launchApp({
      userData: join(E2E, 'user-data-device'),
      dataRoot: join(E2E, 'data'),
      mpvArgs: `--ao=pcm --ao-pcm-file=${join(E2E, 'no-such-folder', 'out.pcm')}`,
    });
    failingPage = await failing.firstWindow();
    await failingPage.waitForLoadState('load');
    await stubFolderDialog(failing, MUSIC);
    await failingPage.getByRole('button', { name: 'Choose a folder' }).click();
    await failingPage.getByRole('tab', { name: 'Albums', exact: true }).waitFor();
    await waitForIdleScan(failingPage);

    await failingPage
      .getByRole('switch', { name: /Exclusive/ })
      .locator('visible=true')
      .click();
    await expect.poll(async () => (await state(failingPage)).outputMode).toBe('exclusive');

    const tracks = await value<Track[]>('library.tracks', { filter: { kind: 'all' } }, failingPage);
    await value('player.play', { trackIds: [tracks[0]?.id, tracks[1]?.id], startIndex: 0 }, failingPage);

    // Exclusive goes first, with a toast and the switch back off.
    await expect(failingPage.getByText(/^This output can't do exclusive mode/)).toBeVisible({ timeout: 20_000 });
    await expect(failingPage.getByRole('switch', { name: /Exclusive/ }).locator('visible=true')).toHaveAttribute(
      'aria-checked',
      'false',
    );

    // This output can't open in shared mode either, so it stops and says so, keeping the track.
    await untilStatus('error', failingPage);
    const alert = failingPage.getByTestId('transport').getByRole('alert');
    await expect(alert).toContainText("couldn't be opened");
    const retry = alert.getByRole('button', { name: 'Retry' });
    await expect(retry).toBeVisible();
    await failingPage.screenshot({ path: join(SCREENSHOTS, 'device-error-1280x800.png') });

    const { loadId } = await state(failingPage);
    await retry.click();
    await until((current) => current.loadId > loadId, failingPage);
    await untilStatus('error', failingPage);
    expect((await state(failingPage)).current?.id).toBe(tracks[0]?.id);
  });

  test('an engine that keeps stopping says so, with Retry, and the library stays usable', async () => {
    failing = await launchApp({
      userData: join(E2E, 'user-data-engine'),
      dataRoot: join(E2E, 'data'),
      mpvArgs: '--ao=null --this-option-does-not-exist',
    });
    failingPage = await failing.firstWindow();
    await failingPage.waitForLoadState('load');
    await stubFolderDialog(failing, MUSIC);
    await failingPage.getByRole('button', { name: 'Choose a folder' }).click();
    await failingPage.getByRole('tab', { name: 'Albums', exact: true }).waitFor();
    await untilStatus('unavailable', failingPage);

    const alert = failingPage.getByTestId('transport').getByRole('alert');
    await expect(alert).toContainText('audio engine keeps stopping');
    await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(failingPage.getByTestId('transport').getByRole('button', { name: 'Next' })).toBeDisabled();
    await failingPage.screenshot({ path: join(SCREENSHOTS, 'engine-error-1280x800.png') });

    await waitForIdleScan(failingPage);
    await failingPage.getByRole('tab', { name: 'Albums', exact: true }).click();
    await expect(failingPage.getByTestId('album-card').first()).toBeVisible();

    const { status } = await state(failingPage);
    expect(status).toBe('unavailable');
    await alert.getByRole('button', { name: 'Retry' }).click();
    await page.waitForTimeout(100);
    await untilStatus('unavailable', failingPage);
  });
});
