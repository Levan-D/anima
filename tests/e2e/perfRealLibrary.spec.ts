/*
 * What the app costs on the real library, to decide what's worth making faster: startup, each page at rest and playing,
 * memory through a few minutes of use, and the equalizer's redraw under a drag. Silent, read-only on the folder, and
 * skipped unless MUSIC_PLAYER_REAL_LIBRARY names it. Needs .dev/real/ui from realLibraryUi.spec.ts. Writes to
 * .dev/real/perf/. Numbers taken while the machine is busy with something else read high.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import type { AlbumSummary, PlayerState, Track } from '@shared/domain';
import { launchApp, resizeWindow, ROOT, settled } from './helpers/app';

const FOLDER = process.env.MUSIC_PLAYER_REAL_LIBRARY;
const SOURCE = join(ROOT, '.dev', 'real', 'ui');
const OUTPUT = join(ROOT, '.dev', 'real', 'perf');
const LAUNCHES = 3;
const COST_SECONDS = 12;
const CHURN_ROUNDS = 6;

test.skip(!FOLDER, 'Set MUSIC_PLAYER_REAL_LIBRARY to the music folder to run this');
test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let page: Page;
const report: Record<string, unknown> = {};

const tab = (name: string) => page.getByRole('tab', { name, exact: true });
const nav = (name: string) => page.getByRole('button', { name, exact: true }).first();

async function value<T>(name: string, input?: unknown): Promise<T> {
  const result = (await page.evaluate(
    ([command, args]) =>
      (window.api.invoke as (...values: unknown[]) => Promise<unknown>)(command, ...(args === undefined ? [] : [args])),
    [name, input] as const,
  )) as { ok: true; value: T } | { ok: false; error: { message: string } };
  if (!result.ok) throw new Error(`${name}: ${result.error.message}`);
  return result.value;
}

function prepare(): void {
  rmSync(join(OUTPUT, 'data'), { recursive: true, force: true });
  mkdirSync(join(OUTPUT, 'user-data'), { recursive: true });
  cpSync(join(SOURCE, 'data'), join(OUTPUT, 'data'), { recursive: true });
  if (!existsSync(join(OUTPUT, 'user-data', 'art-cache'))) {
    cpSync(join(SOURCE, 'user-data', 'art-cache'), join(OUTPUT, 'user-data', 'art-cache'), { recursive: true });
  }
  // Levan's own measurements, so the headphone curve has something to draw.
  const headphones = join(ROOT, '.dev', 'dev-user-data', 'headphones');
  if (existsSync(headphones) && !existsSync(join(OUTPUT, 'user-data', 'headphones'))) {
    cpSync(headphones, join(OUTPUT, 'user-data', 'headphones'), { recursive: true });
  }
  writeFileSync(join(OUTPUT, 'user-data', 'settings.json'), JSON.stringify({ libraryFolder: FOLDER }));
}

async function launch(): Promise<number> {
  const started = performance.now();
  app = await launchApp({ userData: join(OUTPUT, 'user-data'), dataRoot: join(OUTPUT, 'data') });
  page = await app.firstWindow();
  await tab('Albums').waitFor();
  await page.getByTestId('album-card').first().waitFor();
  return Math.round(performance.now() - started);
}

/** Every process's share of one core, and how busy the page's main thread was. */
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
  const round = (amount: number) => Number(amount.toFixed(1));
  const byType: Record<string, number> = {};
  for (const [type, usage] of processes) byType[type] = round((byType[type] ?? 0) + usage * cores);
  return { pageMainThreadPercent: round((busy / seconds) * 100), percentOfOneCore: byType };
}

/** Working set per process type, in MB. */
async function memory() {
  const processes = await app.evaluate(({ app: electronApp }) =>
    electronApp.getAppMetrics().map(({ type, memory: { workingSetSize } }) => [type, workingSetSize] as const),
  );
  const byType: Record<string, number> = {};
  for (const [type, kilobytes] of processes) byType[type] = Math.round((byType[type] ?? 0) + kilobytes / 1024);
  const heap = await page.evaluate(
    () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0,
  );
  return {
    ...byType,
    total: Object.values(byType).reduce((sum, mb) => sum + mb, 0),
    pageHeapMb: Math.round(heap / 2 ** 20),
  };
}

/** Frame times while `during` runs, from requestAnimationFrame. */
async function framesWhile(during: () => Promise<void>) {
  const recording = page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const times: number[] = [];
        let last = performance.now();
        let running = true;
        (window as unknown as { stopFrames: () => void }).stopFrames = () => {
          running = false;
        };
        const tick = (now: number) => {
          times.push(now - last);
          last = now;
          if (running) requestAnimationFrame(tick);
          else resolve(times);
        };
        requestAnimationFrame(tick);
      }),
  );
  await during();
  await page.evaluate(() => (window as unknown as { stopFrames: () => void }).stopFrames());
  const times = (await recording).slice(1).sort((a, b) => a - b);
  const at = (share: number) =>
    Number((times[Math.min(times.length - 1, Math.floor(times.length * share))] ?? 0).toFixed(1));
  return {
    frames: times.length,
    medianMs: at(0.5),
    p95Ms: at(0.95),
    worstMs: at(1),
    over20Ms: times.filter((t) => t > 20).length,
  };
}

async function playSomething(): Promise<void> {
  const albums = await value<AlbumSummary[]>('library.albums', { artistId: null, genreId: null });
  const album = albums.find(({ trackCount }) => trackCount >= 8) ?? albums[0];
  if (!album) throw new Error('No albums');
  const tracks = await value<Track[]>('library.tracks', { filter: { kind: 'album', albumId: album.id } });
  await value('player.play', { trackIds: tracks.map(({ id }) => id), startIndex: 0 });
  await expect.poll(async () => (await value<PlayerState>('player.state')).status).toBe('playing');
}

test.afterAll(async () => {
  await app?.close();
  writeFileSync(join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
});

test('startup, from launch to album covers on screen', async () => {
  test.setTimeout(5 * 60 * 1000);
  prepare();
  const times: number[] = [];
  for (let run = 0; run < LAUNCHES; run++) {
    times.push(await launch());
    if (run < LAUNCHES - 1) await app.close();
  }
  report.startupMs = { each: times, best: Math.min(...times) };
  await resizeWindow(app, page, 1280, 800);
  await settled(page);
});

test('what each page costs, at rest and playing', async () => {
  test.setTimeout(5 * 60 * 1000);
  await page.waitForTimeout(3_000);
  report.idleLibrary = await costOver(COST_SECONDS);
  await playSomething();
  await page.waitForTimeout(1_500);
  report.playingLibrary = await costOver(COST_SECONDS);
  await nav('Radio').click();
  await page.waitForTimeout(2_000);
  report.playingRadio = await costOver(COST_SECONDS);
  await nav('Discover').click();
  await page.waitForTimeout(2_000);
  report.playingDiscover = await costOver(COST_SECONDS);
  await nav('Settings').click();
  await page.waitForTimeout(2_000);
  report.playingSettings = await costOver(COST_SECONDS);
  await page.keyboard.press('Escape');
  await value('player.pause');
  await nav('Radio').click();
  await page.waitForTimeout(2_000);
  report.pausedRadio = await costOver(COST_SECONDS);
  await nav('Library').click();
});

test('memory through a few minutes of use', async () => {
  test.setTimeout(10 * 60 * 1000);
  const samples = [{ round: 0, ...(await memory()) }];
  await value('player.resume');
  for (let round = 1; round <= CHURN_ROUNDS; round++) {
    for (const name of ['Albums', 'Tracks', 'Artists', 'Genres', 'Albums']) {
      await tab(name).click();
      await settled(page);
      await page.getByTestId('list-scroller').evaluate(async (list) => {
        for (let step = 0; step < 20; step++) {
          list.scrollTop += list.clientHeight;
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        list.scrollTop = 0;
      });
    }
    await page.getByTestId('album-card').nth(round).click();
    await page.locator('header h1').waitFor();
    await page.keyboard.press('Escape');
    await nav('Radio').click();
    await page.waitForTimeout(1_500);
    await nav('Library').click();
    await value('player.next');
    await page.waitForTimeout(1_500);
    samples.push({ round, ...(await memory()) });
  }
  report.memoryMb = samples;
});

test('the equalizer redraws under a drag, with the headphones panel open', async () => {
  test.setTimeout(3 * 60 * 1000);
  await page.keyboard.press('e');
  await page.getByTestId('equalizer').waitFor();
  const headphones = page.getByRole('button', { name: 'Headphones', exact: true });
  if ((await headphones.getAttribute('aria-pressed')) !== 'true') await headphones.click();
  await settled(page);
  const plot = page.getByTestId('eq-plot');
  const box = await plot.boundingBox();
  if (!box) throw new Error('No plot');
  // A band to drag: double-click adds one where it lands, if there's none yet.
  if ((await plot.getByRole('slider').count()) === 0)
    await plot.dblclick({ position: { x: box.width / 2, y: box.height / 2 } });
  const point = plot.getByRole('slider').first();
  const at = await point.boundingBox();
  if (!at) throw new Error('No band');
  const start = { x: at.x + at.width / 2, y: at.y + at.height / 2 };
  report.eqDrag = await framesWhile(async () => {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let step = 0; step < 120; step++) {
      const turn = (step / 120) * Math.PI * 4;
      await page.mouse.move(start.x + Math.sin(turn) * box.width * 0.25, start.y + Math.cos(turn) * box.height * 0.2);
    }
    await page.mouse.up();
  });
  report.eqDragCost = await costOver(4);
  await page.keyboard.press('Escape');
});
