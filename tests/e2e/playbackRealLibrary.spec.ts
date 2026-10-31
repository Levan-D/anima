/*
 * The cornerstone on the real library: real albums playing silently with --ao=null, on a copy of the database and the
 * art cache, read-only on the folder. Skipped unless MUSIC_PLAYER_REAL_LIBRARY names it. Needs .dev/real/ui from
 * realLibraryUi.spec.ts. Writes screenshots to .dev/screenshots/phase3/real/ and numbers to .dev/real/playback/report.json.
 */
import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import type { AlbumSummary, PlayerState, Track } from '@shared/domain';
import { launchApp, resizeWindow, ROOT, sendEvent, settled } from './helpers/app';

const FOLDER = process.env.MUSIC_PLAYER_REAL_LIBRARY;
const SOURCE = join(ROOT, '.dev', 'real', 'ui');
const OUTPUT = join(ROOT, '.dev', 'real', 'playback');
const SCREENSHOTS = join(ROOT, '.dev', 'screenshots', 'phase3', 'real');
const SIZES = [
  [1280, 800],
  [1920, 1080],
  [3840, 2160],
] as const;
const WHEEL_BURSTS = 25;

test.skip(!FOLDER, 'Set MUSIC_PLAYER_REAL_LIBRARY to the music folder to run this');
test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let page: Page;
const problems: string[] = [];
const report: Record<string, unknown> = {};

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

function tab(name: string) {
  return page.getByRole('tab', { name, exact: true });
}

function until(check: (state: PlayerState) => boolean) {
  return expect
    .poll(async () => check(await value<PlayerState>('player.state')), { timeout: 20_000, intervals: [50] })
    .toBe(true);
}

async function capture(name: string): Promise<void> {
  for (const [width, height] of SIZES) {
    await resizeWindow(app, page, width, height);
    // Wherever the last click left the pointer, a resize can put something else under it, lit up.
    await page.mouse.move(1, 1);
    await page.waitForTimeout(400);
    await settled(page);
    await page.screenshot({ path: join(SCREENSHOTS, `${name}-${width}x${height}.png`) });
  }
  await resizeWindow(app, page, 1280, 800);
}

/** Starts an album from its first track, through the same command a row sends. */
async function playAlbum(album: AlbumSummary): Promise<void> {
  const tracks = await value<Track[]>('library.tracks', { filter: { kind: 'album', albumId: album.id } });
  await value('player.play', { trackIds: tracks.map(({ id }) => id), startIndex: 0 });
  await until((state) => state.status === 'playing' && state.current?.albumId === album.id);
  await page.waitForTimeout(900);
}

function brightness(hex: string | null): number {
  if (hex === null) return 0;
  const channel = (start: number) => Number.parseInt(hex.slice(start, start + 2), 16);
  return (channel(1) * 299 + channel(3) * 587 + channel(5) * 114) / 1000;
}

function chroma(hex: string | null): number {
  if (hex === null) return 0;
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
  return Math.max(...channels) - Math.min(...channels);
}

type LongFrameSummary = { ms: number; startedAtMs: number; renderMs: number; layoutMs: number; work: string[] };
type Frames = { frames: number[]; longFrames: LongFrameSummary[] };

function scrollAndTime(pixelsPerSecond: number, seconds: number): Promise<Frames> {
  return page.evaluate(
    async ({ speed, duration }) => {
      const scroller = document.querySelector('[data-testid="list-scroller"]');
      if (!scroller) throw new Error('No list on screen');
      const range = scroller.scrollHeight - scroller.clientHeight;

      // What the long frames were doing, because a stall can be anything on a machine that's busy with something else.
      type LongFrame = PerformanceEntry & {
        renderStart: number;
        styleAndLayoutStart: number;
        scripts?: { invoker?: string; duration: number; sourceFunctionName?: string }[];
      };
      const runStartedAt = performance.now();
      const longFrames: LongFrameSummary[] = [];
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as LongFrame[]) {
          const end = entry.startTime + entry.duration;
          longFrames.push({
            ms: Math.round(entry.duration),
            startedAtMs: Math.round(entry.startTime - runStartedAt),
            renderMs: entry.renderStart > 0 ? Math.round(end - entry.renderStart) : 0,
            layoutMs: entry.styleAndLayoutStart > 0 ? Math.round(end - entry.styleAndLayoutStart) : 0,
            work: (entry.scripts ?? []).map(
              ({ invoker, duration: spent, sourceFunctionName }) =>
                `${invoker ?? '?'} ${sourceFunctionName ?? ''} ${Math.round(spent)} ms`,
            ),
          });
        }
      });
      observer.observe({ type: 'long-animation-frame', buffered: false });

      const frames: number[] = [];
      await new Promise<void>((done) => {
        const startedAt = performance.now();
        let last = startedAt;
        const step = (now: number) => {
          frames.push(now - last);
          last = now;
          const distance = ((now - startedAt) / 1000) * speed;
          const position = distance % (range * 2);
          scroller.scrollTop = position <= range ? position : range * 2 - position;
          if (now - startedAt < duration * 1000) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      });
      observer.disconnect();
      return { frames: frames.slice(1), longFrames };
    },
    { speed: pixelsPerSecond, duration: seconds },
  );
}

function summarize({ frames, longFrames }: Frames, refresh: number) {
  const sorted = frames.toSorted((a, b) => a - b);
  const at = (share: number) => Number((sorted[Math.floor((sorted.length - 1) * share)] ?? 0).toFixed(1));
  const dropped = frames.reduce((sum, frame) => sum + Math.max(Math.round(frame / refresh) - 1, 0), 0);
  return {
    frames: frames.length,
    medianMs: at(0.5),
    p95Ms: at(0.95),
    p99Ms: at(0.99),
    worstMs: at(1),
    droppedPercent: Number(((dropped / (frames.length + dropped)) * 100).toFixed(2)),
    longAnimationFrames: longFrames,
  };
}

/**
 * Real wheel input out of a quiet moment, which is what a hand does, and which the runs above don't show: they drive the
 * list from script, one straight after another. The longest the list stopped for in each burst, as the page saw it.
 */
async function wheelBursts(bursts: number) {
  const box = await page.getByTestId('list-scroller').boundingBox();
  if (!box) throw new Error('No list on screen');
  const session = await page.context().newCDPSession(page);
  await page.getByTestId('list-scroller').evaluate((element) => {
    const seen: number[] = [];
    Object.assign(window, { scrollSeen: seen });
    element.addEventListener('scroll', () => seen.push(performance.now()), { passive: true });
  });

  const longest: number[] = [];
  for (let burst = 0; burst < bursts; burst++) {
    await page.waitForTimeout(1_200 + (burst % 4) * 150);
    for (let tick = 0; tick < 25; tick++) {
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
        deltaX: 0,
        deltaY: burst % 2 === 0 ? 60 : -60,
      });
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(200);
    longest.push(
      await page.evaluate(() => {
        const { scrollSeen } = window as unknown as { scrollSeen: number[] };
        const gaps = scrollSeen.slice(1).map((time, index) => time - (scrollSeen[index] as number));
        scrollSeen.length = 0;
        return Math.round(Math.max(0, ...gaps));
      }),
    );
  }
  await session.detach();
  return {
    bursts,
    over100Ms: longest.filter((ms) => ms > 100).length,
    longestGapOfEachMs: longest.toSorted((a, b) => a - b),
  };
}

/** In a window this screen can show, and in one that's bigger than it, with a 4K back buffer as the TV has. */
async function wheelAtBothSizes() {
  const bySize: Record<string, unknown> = {};
  for (const [width, height] of [
    [1280, 800],
    [1920, 1080],
  ] as const) {
    await resizeWindow(app, page, width, height);
    await page.waitForTimeout(1_000);
    bySize[`${width}x${height}`] = await wheelBursts(WHEEL_BURSTS);
  }
  return bySize;
}

function refreshTime(): Promise<number> {
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

/**
 * What it costs over a stretch of time, with nothing else going on: how busy the page's main thread was, from its own
 * metrics, and each of the app's processes, as a percentage of one core. Electron gives those as a share of all of them.
 */
async function costOver(seconds: number) {
  const cores = await page.evaluate(() => navigator.hardwareConcurrency);
  const session = await page.context().newCDPSession(page);
  await session.send('Performance.enable');
  const taskSeconds = async () => {
    const { metrics } = await session.send('Performance.getMetrics');
    return metrics.find(({ name }) => name === 'TaskDuration')?.value ?? 0;
  };
  const before = await taskSeconds();
  const processes = await app.evaluate(async ({ app: electronApp }, wait) => {
    const read = () => electronApp.getAppMetrics().map(({ type, cpu }) => [type, cpu.percentCPUUsage] as const);
    read();
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    return read();
  }, seconds);
  const busy = (await taskSeconds()) - before;
  await session.detach();
  const percent = (value: number) => Number(value.toFixed(2));
  return {
    pageMainThreadBusyPercent: percent((busy / seconds) * 100),
    processesPercentOfOneCore: Object.fromEntries(processes.map(([type, usage]) => [type, percent(usage * cores)])),
  };
}

function writesToTheLineInASecond(): Promise<number> {
  return page
    .getByTestId('seekbar')
    .locator('[data-slot="fill"]')
    .evaluate(async (fill) => {
      let writes = 0;
      const observer = new MutationObserver(() => {
        writes++;
      });
      observer.observe(fill, { attributes: true, attributeFilter: ['style'] });
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      observer.disconnect();
      return writes / 2;
    });
}

test.beforeAll(async () => {
  test.setTimeout(5 * 60 * 1000);
  const folder = FOLDER as string;
  mkdirSync(SCREENSHOTS, { recursive: true });
  rmSync(join(OUTPUT, 'data'), { recursive: true, force: true });
  mkdirSync(join(OUTPUT, 'user-data'), { recursive: true });
  cpSync(join(SOURCE, 'data'), join(OUTPUT, 'data'), { recursive: true });
  // Hundreds of megabytes that nothing here changes, so one copy serves every run.
  if (!existsSync(join(OUTPUT, 'user-data', 'art-cache'))) {
    cpSync(join(SOURCE, 'user-data', 'art-cache'), join(OUTPUT, 'user-data', 'art-cache'), { recursive: true });
  }
  writeFileSync(join(OUTPUT, 'user-data', 'settings.json'), JSON.stringify({ libraryFolder: folder }));

  app = await launchApp({ userData: join(OUTPUT, 'user-data'), dataRoot: join(OUTPUT, 'data') });
  page = await app.firstWindow();
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.startsWith('art://')) problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  await page.waitForLoadState('load');
  await tab('Albums').waitFor();
  await resizeWindow(app, page, 1280, 800);
});

test.afterAll(async () => {
  await app?.close();
});

test('looks right playing real albums, at every size', async () => {
  test.setTimeout(15 * 60 * 1000);
  const folder = FOLDER as string;
  const before = statSync(folder).mtimeMs;

  const albums = await value<AlbumSummary[]>('library.albums', { artistId: null, genreId: null });
  const withArt = albums.filter(({ artColor, trackCount }) => artColor !== null && trackCount >= 3);
  const lightest = withArt.toSorted((a, b) => brightness(b.artColor) - brightness(a.artColor))[0];
  const darkest = withArt.toSorted((a, b) => brightness(a.artColor) - brightness(b.artColor))[0];
  const mostColorful = withArt.toSorted((a, b) => chroma(b.artColor) - chroma(a.artColor))[0];
  const noArt = albums.find(({ artHash }) => artHash === null);
  const typical = withArt[Math.floor(withArt.length / 2)];
  report.albumsLookedAt = {
    typical: typical?.title,
    lightest: lightest?.title,
    darkest: darkest?.title,
    mostColorful: mostColorful?.title,
    noArt: noArt?.title ?? null,
  };

  await capture('idle');

  if (!typical) throw new Error('No albums with art');
  await playAlbum(typical);
  await capture('playing');

  await page.getByRole('button', { name: 'Pause' }).click();
  await until((state) => state.status === 'paused');
  await capture('paused');
  await page.getByRole('button', { name: 'Play', exact: true }).click();

  await tab('Queue').click();
  await page.getByTestId('list-row').first().waitFor();
  await capture('queue');

  for (const [name, album] of [
    ['light-art', lightest],
    ['dark-art', darkest],
    ['colorful-art', mostColorful],
    ['no-art', noArt],
  ] as const) {
    if (!album) continue;
    await playAlbum(album);
    await tab('Albums').click();
    await page.waitForTimeout(800);
    await capture(name);
  }

  // Every album here has art, so this one is told it hasn't: a real title on the sleeve, with no accent to go with it.
  if (!noArt) {
    await playAlbum(typical);
    const state = await value<PlayerState>('player.state');
    await sendEvent(app, 'player.state', {
      ...state,
      current: { ...state.current, artHash: null, artColor: null },
    });
    await page.getByTestId('art').locator('.art-fallback').waitFor();
    await page.waitForTimeout(800);
    await capture('no-art');
    await playAlbum(typical);
  }

  await tab('Albums').click();
  await page.getByRole('searchbox').fill(`${typical.title.slice(0, 40)} ${typical.artist.slice(0, 20)}`);
  await page
    .getByTestId('list-row')
    .filter({ hasText: typical.title })
    .filter({ hasNotText: /\d+ tracks?$/ })
    .first()
    .click({ timeout: 10_000 });
  await expect(page.locator('header h1')).toHaveText(typical.title);
  await capture('album-view');
  await tab('Albums').click();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByTestId('settings').waitFor();
  await capture('settings');
  await page.keyboard.press('Escape');

  expect(statSync(folder).mtimeMs).toBe(before);
  expect(existsSync(join(folder, '.player'))).toBe(false);
});

test('playing does not disturb scrolling, and costs little', async () => {
  test.setTimeout(10 * 60 * 1000);
  const tracks = await value<Track[]>('library.tracks', { filter: { kind: 'all' } });

  await resizeWindow(app, page, 1920, 1080);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.setAlwaysOnTop(true);
    win?.focus();
  });

  await tab('Tracks').click();
  await page.getByTestId('list-row').first().waitFor();
  await value('player.clearQueue');
  await page.waitForTimeout(1_500);

  const refresh = await refreshTime();
  const speeds = [
    ['steady', 1_500],
    ['flick', 8_000],
  ] as const;
  const idle: Record<string, unknown> = { refreshMs: Number(refresh.toFixed(2)) };
  for (const [name, speed] of speeds) idle[name] = summarize(await scrollAndTime(speed, 6), refresh);
  report.scrollingTracksWithNothingPlaying = idle;
  report.wheelWithNothingPlaying = await wheelAtBothSizes();

  // From the top of the list, so the rows it moves through are on screen.
  await page.getByTestId('list-scroller').evaluate((element) => {
    element.scrollTop = 0;
  });
  await value('player.play', { trackIds: tracks.map(({ id }) => id), startIndex: 2 });
  await until((state) => state.status === 'playing');
  await page.waitForTimeout(1_000);
  const playing: Record<string, unknown> = {};
  for (const [name, speed] of speeds) playing[name] = summarize(await scrollAndTime(speed, 6), refresh);
  report.scrollingTracksWhilePlaying = playing;
  await page.getByTestId('list-scroller').evaluate((element) => {
    element.scrollTop = 0;
  });
  report.wheelWhilePlaying = await wheelAtBothSizes();

  // From a new state landing in the store to the rows having changed, with a selector running for each row on screen.
  await page.getByTestId('list-scroller').evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.locator('[data-testid="list-row"][aria-current="true"]').waitFor();
  report.currentRowUpdate = await page.evaluate(async () => {
    const list = document.querySelector('[data-testid="list-scroller"]') as Element;
    const rowsInDom = list.querySelectorAll('[data-testid="list-row"]').length;
    const times: number[] = [];
    for (let run = 0; run < 10; run++) {
      const row = list.querySelector('[aria-current="true"]')?.closest('[data-index]');
      const below = row?.nextElementSibling?.querySelector('[data-testid="list-row"]');
      if (!below) break;
      if (!(row instanceof HTMLElement)) break;
      const landed = await new Promise<number>((resolve) => {
        let heardAt = 0;
        const stop = window.api.on('player.state', () => {
          heardAt ||= performance.now();
        });
        const observer = new MutationObserver(() => {
          if (below.getAttribute('aria-current') !== 'true' || heardAt === 0) return;
          observer.disconnect();
          stop();
          resolve(performance.now() - heardAt);
        });
        observer.observe(below, { attributes: true, attributeFilter: ['aria-current'] });
        void window.api.invoke('player.next');
      });
      times.push(landed);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const sorted = times.toSorted((a, b) => a - b);
    return {
      rowsInDom,
      runs: times.length,
      medianMs: Number((sorted[Math.floor(sorted.length / 2)] ?? 0).toFixed(2)),
      worstMs: Number((sorted.at(-1) ?? 0).toFixed(2)),
    };
  });

  await page.getByTestId('list-scroller').evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.waitForTimeout(2_000);
  report.writesToTheLinePerSecond = await writesToTheLineInASecond();
  await page.getByRole('tab', { name: 'Albums', exact: true }).click();
  await page.getByTestId('album-card').first().waitFor();
  await page.waitForTimeout(2_000);
  report.costWhilePlaying = await costOver(15);

  // With the little bars on screen as well, which run on the compositor at the full refresh rate.
  await page.getByRole('tab', { name: 'Queue', exact: true }).click();
  await page.locator('[data-testid="list-row"][aria-current="true"]').waitFor();
  await page.waitForTimeout(1_000);
  report.costWhilePlayingWithBarsShowing = await costOver(15);

  await page.getByRole('button', { name: 'Pause' }).click();
  await page.waitForTimeout(2_000);
  report.costWhilePaused = await costOver(15);

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setAlwaysOnTop(false));

  report.problems = problems;
  writeFileSync(join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  expect(problems).toEqual([]);
});
