/*
 * The built UI against the real music folder: how it scrolls, and how it looks with real art and real tags.
 * Read-only on the folder. Skipped unless MUSIC_PLAYER_REAL_LIBRARY names it. Writes to .dev/real/ui/ and
 * .dev/screenshots/phase2/real/.
 */
import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import type { AlbumSummary, ScanState, Track } from '@shared/domain';
import { launchApp, resizeWindow, ROOT, settled, stubFolderDialog } from './helpers/app';

const FOLDER = process.env.MUSIC_PLAYER_REAL_LIBRARY;
const OUTPUT = join(ROOT, '.dev', 'real', 'ui');
const SCANNED_BEFORE = join(ROOT, '.dev', 'real', 'app');
const FIRST_SCAN = join(ROOT, '.dev', 'real', 'ui-first-scan');
const SCREENSHOTS = join(ROOT, '.dev', 'screenshots', 'phase2', 'real');
const SIZES = [
  [1280, 800],
  [1920, 1080],
  [3840, 2160],
] as const;

test.skip(!FOLDER, 'Set MUSIC_PLAYER_REAL_LIBRARY to the music folder to run this');
test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let page: Page;
const report: Record<string, unknown> = {};

type Speed = { name: string; pixelsPerSecond: number };

/** A mouse wheel going steadily, a flick, and dragging the scrollbar quickly. */
const SPEEDS: Speed[] = [
  { name: 'steady', pixelsPerSecond: 1_500 },
  { name: 'flick', pixelsPerSecond: 8_000 },
  { name: 'scrollbar drag', pixelsPerSecond: 60_000 },
];

const SECONDS_PER_RUN = 6;

/** Scrolls by script on every frame and records how long each frame took, with nothing else going on. */
function scrollAndTime({ pixelsPerSecond, seconds }: { pixelsPerSecond: number; seconds: number }) {
  return page.evaluate(
    async ({ pixelsPerSecond: speed, seconds: duration }) => {
      const scroller = document.querySelector('[data-testid="list-scroller"]');
      if (!scroller) throw new Error('No list on screen');
      const range = scroller.scrollHeight - scroller.clientHeight;

      const longFrames: number[] = [];
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longFrames.push(entry.duration);
      });
      observer.observe({ type: 'long-animation-frame', buffered: false });

      const frames: number[] = [];
      await new Promise<void>((done) => {
        const startedAt = performance.now();
        let last = startedAt;
        const step = (now: number) => {
          frames.push(now - last);
          last = now;
          // Back and forth, so a short list still gets the whole run.
          const distance = ((now - startedAt) / 1000) * speed;
          const position = distance % (range * 2);
          scroller.scrollTop = position <= range ? position : range * 2 - position;
          if (now - startedAt < duration * 1000) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      });

      observer.disconnect();
      return { frames: frames.slice(1), longFrames, rowsInDom: scroller.querySelectorAll('[data-index]').length };
    },
    { pixelsPerSecond, seconds },
  );
}

function idleFrameTime() {
  return page.evaluate(async () => {
    const times: number[] = [];
    let last = performance.now();
    await new Promise<void>((done) => {
      const step = (now: number) => {
        times.push(now - last);
        last = now;
        if (times.length < 90) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });
    return times.slice(1).toSorted((a, b) => a - b)[Math.floor(times.length / 2)] ?? 16.7;
  });
}

function summarize(frames: number[], refresh: number) {
  const sorted = frames.toSorted((a, b) => a - b);
  const at = (share: number) => Number((sorted[Math.floor((sorted.length - 1) * share)] ?? 0).toFixed(1));
  const dropped = frames.reduce((sum, frame) => sum + Math.max(Math.round(frame / refresh) - 1, 0), 0);
  return {
    frames: frames.length,
    medianMs: at(0.5),
    p95Ms: at(0.95),
    p99Ms: at(0.99),
    worstMs: at(1),
    droppedFrames: dropped,
    droppedPercent: Number(((dropped / (frames.length + dropped)) * 100).toFixed(2)),
  };
}

async function measure(name: string): Promise<void> {
  const refresh = await idleFrameTime();
  const results: Record<string, unknown> = { refreshMs: Number(refresh.toFixed(2)) };
  for (const { name: speed, pixelsPerSecond } of SPEEDS) {
    const { frames, longFrames, rowsInDom } = await scrollAndTime({ pixelsPerSecond, seconds: SECONDS_PER_RUN });
    results[speed] = {
      ...summarize(frames, refresh),
      longAnimationFrames: longFrames.length,
      worstLongAnimationFrameMs: Math.round(Math.max(0, ...longFrames)),
      rowsInDom,
    };
  }
  report[name] = results;
}

async function measureAtThisDisplayScale(scale: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.setAlwaysOnTop(true);
    win?.focus();
  });

  for (const [width, height] of [
    [1280, 800],
    [1920, 1080],
  ] as const) {
    await resizeWindow(app, page, width, height);
    await tab('Tracks').click();
    await page.getByTestId('list-row').first().waitFor();
    await page.waitForTimeout(1_000);
    await measure(`tracks at ${width}x${height}, ${scale}`);

    await tab('Albums').click();
    await page.getByTestId('album-card').first().waitFor();
    await page.waitForTimeout(1_000);
    await measure(`albums at ${width}x${height}, ${scale}`);
  }

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setAlwaysOnTop(false));
}

async function capture(name: string): Promise<void> {
  for (const [width, height] of SIZES) {
    await resizeWindow(app, page, width, height);
    await page.waitForTimeout(400);
    await settled(page);
    await page.screenshot({ path: join(SCREENSHOTS, `${name}-${width}x${height}.png`) });
  }
  await resizeWindow(app, page, 1280, 800);
}

function tab(name: string) {
  return page.getByRole('tab', { name, exact: true });
}

async function value<T>(name: string, input?: unknown): Promise<T> {
  const result = await page.evaluate(
    ([command, argument]) =>
      (window.api.invoke as (name: unknown, input?: unknown) => Promise<{ ok: boolean; value?: unknown }>)(
        command,
        argument,
      ),
    [name, input],
  );
  expect(result, name).toMatchObject({ ok: true });
  return result.value as T;
}

async function openAlbum({ title, artist }: AlbumSummary): Promise<void> {
  await page.getByRole('searchbox').fill(`${title.slice(0, 40)} ${artist.slice(0, 20)}`);
  await page
    .getByTestId('list-row')
    .filter({ hasText: title })
    .filter({ hasNotText: /\d+ tracks?$/ })
    .first()
    .click({ timeout: 10_000 });
  await expect(page.locator('header h1')).toHaveText(title);
}

test('the very first scan: the list fills in, scrolls and keeps its place while it does', async () => {
  test.setTimeout(30 * 60 * 1000);
  const folder = FOLDER as string;
  const before = statSync(folder);

  rmSync(FIRST_SCAN, { recursive: true, force: true });
  mkdirSync(FIRST_SCAN, { recursive: true });
  mkdirSync(SCREENSHOTS, { recursive: true });

  app = await launchApp({ userData: join(FIRST_SCAN, 'user-data'), dataRoot: join(FIRST_SCAN, 'data') });
  page = await app.firstWindow();
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.startsWith('art://')) problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  await page.waitForLoadState('load');
  await resizeWindow(app, page, 1280, 800);
  await stubFolderDialog(app, folder);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.setAlwaysOnTop(true);
    win?.focus();
  });

  await page.getByRole('button', { name: 'Choose a folder' }).click();
  await tab('Tracks').click();

  const phaseNow = async () => (await value<ScanState>('scan.state')).phase;
  const scanReport: Record<string, unknown> = {};
  const seenPhases = new Set<string>();

  for (;;) {
    const phase = await phaseNow();
    if (phase === 'idle') break;
    if (seenPhases.has(phase) || phase === 'walking' || phase === 'writing') {
      await page.waitForTimeout(250);
      continue;
    }
    if ((await page.getByTestId('list-row').count()) === 0) {
      await page.waitForTimeout(250);
      continue;
    }
    seenPhases.add(phase);

    await page.screenshot({ path: join(SCREENSHOTS, `first-scan-${phase}-1280x800.png`) });
    const refresh = await idleFrameTime();

    // The scroll position through a few refreshes, then frames while scrolling through whatever's there so far.
    const position = await page.getByTestId('list-scroller').evaluate(async (scroller) => {
      scroller.scrollTop = Math.min(4_000, scroller.scrollHeight / 2);
      const set = scroller.scrollTop;
      await new Promise((done) => setTimeout(done, 3_500));
      return { set, after: scroller.scrollTop };
    });
    const { frames, longFrames } = await scrollAndTime({ pixelsPerSecond: 1_500, seconds: SECONDS_PER_RUN });
    scanReport[phase] = {
      scrollPositionThroughRefreshes: position,
      ...summarize(frames, refresh),
      longAnimationFrames: longFrames.length,
      worstLongAnimationFrameMs: Math.round(Math.max(0, ...longFrames)),
    };
    await page.getByTestId('list-scroller').evaluate((scroller) => {
      scroller.scrollTop = 0;
    });
    expect(position.after).toBe(position.set);
  }

  await tab('Albums').click();
  await page.getByTestId('album-card').first().waitFor();
  await settled(page);
  await page.screenshot({ path: join(SCREENSHOTS, 'first-scan-finished-1280x800.png') });

  await app.close();
  const after = statSync(folder);
  report.firstScan = scanReport;
  report.firstScanProblems = problems;
  writeFileSync(join(FIRST_SCAN, 'report.json'), JSON.stringify(scanReport, null, 2));
  expect(problems).toEqual([]);
  expect(after.mtimeMs).toBe(before.mtimeMs);
  expect(existsSync(join(folder, '.player'))).toBe(false);
});

test('the real library scrolls at full frame rate, and looks right', async () => {
  test.setTimeout(30 * 60 * 1000);
  const folder = FOLDER as string;
  const before = statSync(folder);
  expect(existsSync(join(folder, '.player'))).toBe(false);

  mkdirSync(SCREENSHOTS, { recursive: true });
  // Reuses the scan the real-library test already did, if there is one. Scanning again takes minutes.
  if (!existsSync(OUTPUT) && existsSync(SCANNED_BEFORE)) cpSync(SCANNED_BEFORE, OUTPUT, { recursive: true });
  mkdirSync(OUTPUT, { recursive: true });

  app = await launchApp({ userData: join(OUTPUT, 'user-data'), dataRoot: join(OUTPUT, 'data') });
  page = await app.firstWindow();
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.startsWith('art://')) problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  await page.waitForLoadState('load');

  if (await page.getByRole('button', { name: 'Choose a folder' }).isVisible()) {
    await stubFolderDialog(app, folder);
    await page.getByRole('button', { name: 'Choose a folder' }).click();
  }
  await tab('Albums').waitFor();
  await expect
    .poll(async () => (await value<{ phase: string }>('scan.state')).phase, { timeout: 15 * 60 * 1000 })
    .toBe('idle');

  await measureAtThisDisplayScale('native scale');

  // A normal monitor or TV has no high-DPI scaling to hide behind, and Chromium paints text and scrolling differently.
  await app.close();
  app = await launchApp({
    userData: join(OUTPUT, 'user-data'),
    dataRoot: join(OUTPUT, 'data'),
    switches: ['--force-device-scale-factor=1'],
  });
  page = await app.firstWindow();
  await page.waitForLoadState('load');
  await tab('Albums').waitFor();
  await measureAtThisDisplayScale('scale 1');
  await app.close();

  app = await launchApp({ userData: join(OUTPUT, 'user-data'), dataRoot: join(OUTPUT, 'data') });
  page = await app.firstWindow();
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.startsWith('art://')) problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  await page.waitForLoadState('load');
  await tab('Albums').waitFor();

  await resizeWindow(app, page, 1280, 800);
  await page.getByTestId('list-scroller').evaluate((element) => {
    element.scrollTop = 0;
  });
  await tab('Tracks').click();
  await page.getByTestId('list-row').first().waitFor();
  await page.getByTestId('list-scroller').evaluate((element) => {
    element.scrollTop = 0;
  });
  await capture('tracks');

  await tab('Albums').click();
  await capture('albums');

  await tab('Artists').click();
  await page.getByTestId('list-row').first().waitFor();
  await capture('artists');

  await tab('Genres').click();
  await page.getByTestId('list-row').first().waitFor();
  await capture('genres');

  const albums = await value<AlbumSummary[]>('library.albums', { artistId: null, genreId: null });
  const tracks = await value<Track[]>('library.tracks', { filter: { kind: 'all' } });

  const longest = albums.toSorted((a, b) => b.title.length - a.title.length)[0];
  const unicode = albums.find(({ title }) => /\p{Script=Cyrillic}|\p{Script=Han}|\p{Script=Hiragana}/u.test(title));
  const noArt = albums.find(({ artHash }) => artHash === null);
  const mostTracks = albums.toSorted((a, b) => b.trackCount - a.trackCount)[0];
  const discsOf = new Map<number, Set<number>>();
  for (const { albumId, discNumber } of tracks) {
    if (albumId === null || discNumber === null) continue;
    discsOf.set(albumId, (discsOf.get(albumId) ?? new Set()).add(discNumber));
  }
  const mostDiscs = albums.toSorted((a, b) => (discsOf.get(b.id)?.size ?? 0) - (discsOf.get(a.id)?.size ?? 0))[0];

  report.albumsLookedAt = {
    longestTitle: longest?.title ?? null,
    unicodeTitle: unicode?.title ?? null,
    noArtTitle: noArt?.title ?? null,
    mostTracks: mostTracks ? `${mostTracks.title} (${mostTracks.trackCount})` : null,
    mostDiscs: mostDiscs ? `${mostDiscs.title} (${discsOf.get(mostDiscs.id)?.size ?? 0})` : null,
  };

  for (const [name, album] of [
    ['album-longest-title', longest],
    ['album-unicode', unicode],
    ['album-no-art', noArt],
    ['album-most-tracks', mostTracks],
  ] as const) {
    if (!album) continue;
    await openAlbum(album);
    await capture(name);
    await tab('Albums').click();
  }

  await page.getByRole('searchbox').fill('night');
  await page.getByTestId('list-row').first().waitFor();
  await capture('search');
  await page.keyboard.press('Escape');

  await page.getByRole('searchbox').fill('nightwish');
  await page
    .getByTestId('list-row')
    .filter({ hasText: /^Nightwish/ })
    .first()
    .click({ timeout: 10_000 });
  await expect(page.locator('header h1')).toHaveText('Nightwish');
  await capture('artist');
  await tab('Albums').click();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByTestId('settings').waitFor();
  await capture('settings');
  await page.getByRole('button', { name: 'Back' }).click();

  report.problems = problems;
  await app.close();

  const after = statSync(folder);
  report.mtimeUnchanged = after.mtimeMs === before.mtimeMs;
  report.playerFolder = existsSync(join(folder, '.player'));
  writeFileSync(join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2));

  expect(after.mtimeMs).toBe(before.mtimeMs);
  expect(existsSync(join(folder, '.player'))).toBe(false);
  expect(problems).toEqual([]);
});
