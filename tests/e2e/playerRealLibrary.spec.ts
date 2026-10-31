/*
 * What the Player costs on the real library: latency, a queue of everything, the IPC message, CPU, and whether main is
 * ever held up. Runs on a copy of the database in .dev, and is read-only on the folder. Silent, with --ao=null. Skipped
 * unless MUSIC_PLAYER_REAL_LIBRARY names the folder. Needs .dev/real/ui from realLibraryUi.spec.ts. Writes to
 * .dev/real/player/report.json.
 */
import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import type { PlayerPosition, PlayerState, Track } from '@shared/domain';
import { launchApp, ROOT } from './helpers/app';

const FOLDER = process.env.MUSIC_PLAYER_REAL_LIBRARY;
const SOURCE = join(ROOT, '.dev', 'real', 'ui');
const OUTPUT = join(ROOT, '.dev', 'real', 'player');
const RUNS = 15;
const CPU_SECONDS = 30;

test.skip(!FOLDER, 'Set MUSIC_PLAYER_REAL_LIBRARY to the music folder to run this');

function summary(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  const round = (value: number | undefined) => Number((value ?? 0).toFixed(1));
  return {
    runs: sorted.length,
    median: round(sorted[Math.floor(sorted.length / 2)]),
    p90: round(sorted[Math.floor(sorted.length * 0.9)]),
    max: round(sorted.at(-1)),
  };
}

let app: ElectronApplication;
let page: Page;

/** How long main's event loop was held up during a piece of work, with a timer running all the time on its thread. */
async function startWatchingMain() {
  await app.evaluate(() => {
    const watch = { last: performance.now(), worst: 0 };
    Object.assign(globalThis, { watch });
    setInterval(() => {
      const now = performance.now();
      watch.worst = Math.max(watch.worst, now - watch.last);
      watch.last = now;
    }, 1);
  });
}

const resetWatch = () =>
  app.evaluate(() => {
    const { watch } = globalThis as unknown as { watch: { last: number; worst: number } };
    watch.worst = 0;
  });

const worstHoldUp = () => app.evaluate(() => (globalThis as unknown as { watch: { worst: number } }).watch.worst);

/** What a command costs from the page's side, and the longest main was busy while it ran, each over several runs. */
async function measureCommand(name: string, input: () => unknown, times = 5) {
  const roundTrips: number[] = [];
  const holdUps: number[] = [];
  for (let run = 0; run < times; run++) {
    await resetWatch();
    const roundTrip = await page.evaluate(
      async ([command, args]) => {
        const at = performance.now();
        const result = await (window.api.invoke as (...values: unknown[]) => Promise<{ ok: boolean }>)(
          command,
          ...(args === undefined ? [] : [args]),
        );
        if (!result.ok) throw new Error(`${command} failed`);
        return performance.now() - at;
      },
      [name, input()] as const,
    );
    roundTrips.push(roundTrip);
    // Whatever it set off in main happens by now too.
    await page.waitForTimeout(150);
    holdUps.push(await worstHoldUp());
  }
  return { roundTripMs: summary(roundTrips), mainHeldUpMs: summary(holdUps) };
}

test('measures the Player on the real library', async () => {
  test.setTimeout(10 * 60 * 1000);
  const folder = FOLDER as string;
  const before = statSync(folder).mtimeMs;

  rmSync(OUTPUT, { recursive: true, force: true });
  mkdirSync(join(OUTPUT, 'user-data'), { recursive: true });
  cpSync(join(SOURCE, 'data'), join(OUTPUT, 'data'), { recursive: true });
  cpSync(join(SOURCE, 'user-data', 'art-cache'), join(OUTPUT, 'user-data', 'art-cache'), { recursive: true });
  writeFileSync(join(OUTPUT, 'user-data', 'settings.json'), JSON.stringify({ libraryFolder: folder }));

  app = await launchApp({ userData: join(OUTPUT, 'user-data'), dataRoot: join(OUTPUT, 'data') });
  page = await app.firstWindow();
  await page.waitForLoadState('load');
  await page.getByRole('tab', { name: 'Albums' }).waitFor();
  await startWatchingMain();

  const report: Record<string, unknown> = {};
  const ids = await page.evaluate(async () => {
    const tracks = await window.api.invoke('library.tracks', { filter: { kind: 'all' } });
    if (!tracks.ok) throw new Error(tracks.error.message);
    return tracks.value.map(({ id }: Track) => id);
  });
  report.tracks = ids.length;
  expect(ids.length).toBe(5719);

  // What main does when nothing's going on, to compare with. The art pass from opening the library has time to finish.
  await page.waitForTimeout(5000);
  await resetWatch();
  await page.waitForTimeout(2000);
  report.mainHeldUpIdleMs = Number((await worstHoldUp()).toFixed(1));

  await page.evaluate(() => {
    const seen = {
      states: [] as { at: number; state: PlayerState }[],
      positions: [] as { at: number; position: PlayerPosition }[],
    };
    Object.assign(window, { seen });
    window.api.on('player.state', (state) => seen.states.push({ at: performance.now(), state }));
    window.api.on('player.position', (position) => seen.positions.push({ at: performance.now(), position }));
  });

  // Command to state, on real files. An album's worth at a time, from all over the library.
  const stride = Math.floor(ids.length / RUNS);
  const latency = await page.evaluate(
    async ({ all, runs, step }) => {
      const { seen } = window as unknown as {
        seen: {
          states: { at: number; state: PlayerState }[];
          positions: { at: number; position: PlayerPosition }[];
        };
      };

      /** Resolves with the time of the first event after `from` that passes. */
      const nextEvent = <T>(list: { at: number }[], check: (item: T) => boolean, from: number) =>
        new Promise<number>((resolve, reject) => {
          const started = performance.now();
          const look = () => {
            const hit = (list as (T & { at: number })[]).find((item) => item.at >= from && check(item));
            if (hit) resolve(hit.at - from);
            else if (performance.now() - started > 15_000) reject(new Error('Timed out waiting for an event'));
            else setTimeout(look, 0);
          };
          look();
        });

      const results = {
        playFirstState: [] as number[],
        playToPlaying: [] as number[],
        nextFirstState: [] as number[],
        nextToPlaying: [] as number[],
        seekToPosition: [] as number[],
        seekToMovingOn: [] as number[],
        pauseToState: [] as number[],
        resumeToState: [] as number[],
      };

      for (let run = 0; run < runs; run++) {
        const start = run * step;
        const album = all.slice(start, start + 12);

        let at = performance.now();
        await window.api.invoke('player.play', { trackIds: album, startIndex: 0 });
        results.playFirstState.push(
          await nextEvent<{ state: PlayerState }>(seen.states, ({ state }) => state.current?.id === album[0], at),
        );
        results.playToPlaying.push(
          await nextEvent<{ state: PlayerState }>(
            seen.states,
            ({ state }) => state.current?.id === album[0] && state.status === 'playing',
            at,
          ),
        );
        await new Promise((resolve) => setTimeout(resolve, 300));

        at = performance.now();
        const target = 20_000;
        await window.api.invoke('player.seek', { positionMs: target });
        results.seekToPosition.push(
          await nextEvent<{ position: PlayerPosition }>(
            seen.positions,
            ({ position }) => position.positionMs === target,
            at,
          ),
        );
        results.seekToMovingOn.push(
          await nextEvent<{ position: PlayerPosition }>(
            seen.positions,
            ({ position }) => position.positionMs > target,
            at,
          ),
        );

        at = performance.now();
        await window.api.invoke('player.pause');
        results.pauseToState.push(
          await nextEvent<{ state: PlayerState }>(seen.states, ({ state }) => state.status === 'paused', at),
        );
        at = performance.now();
        await window.api.invoke('player.resume');
        results.resumeToState.push(
          await nextEvent<{ state: PlayerState }>(seen.states, ({ state }) => state.status === 'playing', at),
        );

        at = performance.now();
        await window.api.invoke('player.next');
        results.nextFirstState.push(
          await nextEvent<{ state: PlayerState }>(seen.states, ({ state }) => state.current?.id === album[1], at),
        );
        results.nextToPlaying.push(
          await nextEvent<{ state: PlayerState }>(
            seen.states,
            ({ state }) => state.current?.id === album[1] && state.status === 'playing',
            at,
          ),
        );
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      seen.states.length = 0;
      seen.positions.length = 0;
      return results;
    },
    { all: ids, runs: RUNS, step: stride },
  );
  report.commandToStateMs = Object.fromEntries(
    Object.entries(latency).map(([name, values]) => [name, summary(values)]),
  );

  // A queue of everything.
  await resetWatch();
  const everything = await page.evaluate(async (all) => {
    const times: number[] = [];
    for (let run = 0; run < 5; run++) {
      const at = performance.now();
      const result = await window.api.invoke('player.play', { trackIds: all, startIndex: run });
      if (!result.ok) throw new Error(result.error.message);
      times.push(performance.now() - at);
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    return times;
  }, ids);
  report.replaceWithEverything = {
    roundTripMs: summary(everything),
    mainHeldUpMs: Number((await worstHoldUp()).toFixed(1)),
  };

  report.replaceWithEverythingSeparately = await measureCommand('player.play', () => ({
    trackIds: ids,
    startIndex: 0,
  }));
  report.playerQueueCommand = await measureCommand('player.queue', () => undefined);
  report.playerStateCommand = await measureCommand('player.state', () => undefined);
  report.libraryTracksForComparison = await measureCommand('library.tracks', () => ({ filter: { kind: 'all' } }));

  report.messageSizes = await page.evaluate(async () => {
    const encoded = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
    const queue = await window.api.invoke('player.queue');
    const state = await window.api.invoke('player.state');
    if (!queue.ok || !state.ok) throw new Error('Could not read them');
    return {
      queueItems: queue.value.length,
      queueJsonBytes: encoded(queue.value),
      stateJsonBytes: encoded(state.value),
    };
  });

  // Queue operations with everything in the queue.
  const queueIds = await page.evaluate(async () => {
    const queue = await window.api.invoke('player.queue');
    if (!queue.ok) throw new Error(queue.error.message);
    return queue.value.map(({ queueId }) => queueId);
  });
  const middle = () => queueIds[Math.floor(queueIds.length / 2)] as number;
  report.queueOperationsOnEverything = {
    moveOne: await measureCommand('player.moveInQueue', () => ({ queueId: middle(), toIndex: 1 }), 10),
    enqueueAlbumNext: await measureCommand('player.enqueue', () => ({ trackIds: ids.slice(0, 12), where: 'next' }), 10),
    enqueueEverythingAtEnd: await measureCommand('player.enqueue', () => ({ trackIds: ids, where: 'end' }), 3),
    removeAThousand: await measureCommand('player.removeFromQueue', () => ({ queueIds: queueIds.slice(100, 1100) }), 1),
    next: await measureCommand('player.next', () => undefined, 10),
    previous: await measureCommand('player.previous', () => undefined, 10),
    clear: await measureCommand('player.clearQueue', () => undefined, 1),
  };

  // CPU in main, with nothing playing and then while playing, with a window listening to position.
  const cpu = (seconds: number) =>
    app.evaluate(async ({ app: electronApp }, waitSeconds) => {
      const before = process.cpuUsage();
      const at = performance.now();
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
      const used = process.cpuUsage(before);
      const wall = performance.now() - at;
      const browser = electronApp.getAppMetrics().find(({ type }) => type === 'Browser');
      return {
        percentOfOneCore: Number((((used.user + used.system) / 1000 / wall) * 100).toFixed(2)),
        electronSaysPercent: browser ? Number(browser.cpu.percentCPUUsage.toFixed(2)) : null,
      };
    }, seconds);

  const idle = await cpu(10);
  await page.evaluate(async (all) => {
    await window.api.invoke('player.play', { trackIds: all.slice(0, 40), startIndex: 0 });
  }, ids);
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const { seen } = window as unknown as { seen: { states: unknown[]; positions: unknown[] } };
    seen.states.length = 0;
    seen.positions.length = 0;
  });
  const whilePlaying = await cpu(CPU_SECONDS);
  const during = await page.evaluate(() => {
    const { seen } = window as unknown as { seen: { states: unknown[]; positions: unknown[] } };
    return { positions: seen.positions.length, states: seen.states.length };
  });
  report.cpuInMain = {
    idle,
    whilePlaying,
    positionsPerSecond: Number((during.positions / CPU_SECONDS).toFixed(2)),
    statesDuring: during.states,
  };

  const quitAt = Date.now();
  await app.close();
  report.quitMs = Date.now() - quitAt;

  report.folderUntouched = statSync(folder).mtimeMs === before && !existsSync(join(folder, '.player'));
  writeFileSync(join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  expect(report.folderUntouched).toBe(true);

  rmSync(join(OUTPUT, 'user-data', 'art-cache'), { recursive: true, force: true });
});
