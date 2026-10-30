/*
 * The built app against a real music folder: real worker threads, real IPC, real art:// requests.
 * Read-only on the folder. Skipped unless MUSIC_PLAYER_REAL_LIBRARY names it. Writes to .dev/real/app/.
 */
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { _electron as electron } from 'playwright';
import type { ScanState } from '@shared/domain';

const FOLDER = process.env.MUSIC_PLAYER_REAL_LIBRARY;
const ROOT = resolve(import.meta.dirname, '../..');
const OUTPUT = join(ROOT, '.dev', 'real', 'app');

const { CHROME_CRASHPAD_PIPE_NAME: _parentCrashHandler, ...parentEnv } = process.env;

test.skip(!FOLDER, 'Set MUSIC_PLAYER_REAL_LIBRARY to the music folder to run this');

test('opens and scans the real library through the whole app', async () => {
  test.setTimeout(30 * 60 * 1000);
  const folder = FOLDER as string;
  const before = statSync(folder);

  rmSync(OUTPUT, { recursive: true, force: true });
  mkdirSync(OUTPUT, { recursive: true });

  const launch = () =>
    electron.launch({
      args: ['.', `--user-data-dir=${join(OUTPUT, 'user-data')}`],
      cwd: ROOT,
      env: { ...parentEnv, MUSIC_PLAYER_DATA_DIR: join(OUTPUT, 'data'), MUSIC_PLAYER_MPV_ARGS: '--ao=null' },
    });

  let app = await launch();
  let page = await app.firstWindow();
  await page.waitForLoadState('load');

  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [picked] });
  }, folder);

  const report: Record<string, unknown> = {};
  const started = Date.now();
  expect(await page.evaluate(() => window.api.invoke('library.chooseFolder'))).toMatchObject({
    ok: true,
    value: { state: 'ready' },
  });

  const phaseTimes: Record<string, number> = {};
  const trackCounts: { atSeconds: number; tracks: number; ms: number }[] = [];
  let onDemand: { requested: number; ok: number; firstMs: number; lastMs: number } | null = null;
  for (;;) {
    const state = await page.evaluate(() => window.api.invoke('scan.state'));
    if (!state.ok) throw new Error(state.error.message);
    const { phase }: ScanState = state.value;
    phaseTimes[phase] ??= (Date.now() - started) / 1000;
    if (phase === 'idle') break;

    // What the list would see while it fills in, and whether the main thread stays quick during the scan.
    const read = await page.evaluate(async () => {
      const at = performance.now();
      const tracks = await window.api.invoke('library.tracks', { filter: { kind: 'all' } });
      return { ms: performance.now() - at, count: tracks.ok ? tracks.value.length : -1 };
    });
    trackCounts.push({ atSeconds: (Date.now() - started) / 1000, tracks: read.count, ms: Math.round(read.ms) });

    // Art the list would ask for while it's filling in, before the art phase has made any of it.
    if (phase === 'reading' && read.count > 500 && onDemand === null) {
      onDemand = await page.evaluate(async () => {
        const albums = await window.api.invoke('library.albums', { artistId: null, genreId: null });
        if (!albums.ok) throw new Error(albums.error.message);
        const hashes = albums.value.flatMap(({ artHash }) => artHash ?? []).slice(0, 24);
        const at = performance.now();
        const times = await Promise.all(
          hashes.map(async (hash) => {
            const response = await fetch(`art://thumb/${hash}`);
            await response.arrayBuffer();
            return { status: response.status, ms: Math.round(performance.now() - at) };
          }),
        );
        return {
          requested: hashes.length,
          ok: times.filter(({ status }) => status === 200).length,
          firstMs: Math.min(...times.map(({ ms }) => ms)),
          lastMs: Math.max(...times.map(({ ms }) => ms)),
        };
      });
    }
    await new Promise((done) => setTimeout(done, 2000));
  }
  report.onDemandArtWhileReading = onDemand;
  report.phaseStartedAtSeconds = phaseTimes;
  report.whileScanning = trackCounts.filter((_, index) => index % 5 === 0);
  report.worstReadWhileScanningMs = Math.max(...trackCounts.map(({ ms }) => ms));

  const final = await page.evaluate(() => window.api.invoke('scan.state'));
  report.lastReport = final.ok ? final.value.lastReport : null;

  const roundTrips = await page.evaluate(async () => {
    const time = async (work: () => Promise<unknown>) => {
      const times: number[] = [];
      for (let run = 0; run < 7; run++) {
        const at = performance.now();
        await work();
        times.push(performance.now() - at);
      }
      return Number(times.toSorted((a, b) => a - b)[3]?.toFixed(1));
    };
    return {
      tracksAll: await time(() => window.api.invoke('library.tracks', { filter: { kind: 'all' } })),
      artists: await time(() => window.api.invoke('library.artists')),
      albums: await time(() => window.api.invoke('library.albums', { artistId: null, genreId: null })),
      genres: await time(() => window.api.invoke('library.genres')),
      search: await time(() => window.api.invoke('library.search', { query: 'night' })),
    };
  });
  report.ipcRoundTripMedianMs = roundTrips;

  const art = await page.evaluate(async () => {
    const albums = await window.api.invoke('library.albums', { artistId: null, genreId: null });
    if (!albums.ok) throw new Error(albums.error.message);
    const hashes = albums.value.flatMap(({ artHash }) => artHash ?? []).slice(0, 60);
    const at = performance.now();
    const statuses = await Promise.all(
      hashes.map(async (hash) => {
        const response = await fetch(`art://thumb/${hash}`);
        await response.arrayBuffer();
        return response.status;
      }),
    );
    return {
      requested: hashes.length,
      ok: statuses.filter((status) => status === 200).length,
      ms: Math.round(performance.now() - at),
      withColor: albums.value.filter(({ artColor }) => artColor !== null).length,
      albums: albums.value.length,
    };
  });
  report.art = art;
  expect(art.ok).toBe(art.requested);

  const storage = await page.evaluate(() => window.api.invoke('system.storageInfo'));
  report.storage = storage;

  const quitAt = Date.now();
  await app.close();
  report.quitMs = Date.now() - quitAt;

  // A restart on a real database: how long until the library answers.
  const relaunchedAt = Date.now();
  app = await launch();
  page = await app.firstWindow();
  await page.waitForLoadState('load');
  const status = await page.evaluate(() => window.api.invoke('library.status'));
  report.relaunchToReadyMs = Date.now() - relaunchedAt;
  expect(status).toMatchObject({ ok: true, value: { state: 'ready', isEmpty: false } });
  await app.close();

  const after = statSync(folder);
  report.mtimeUnchanged = after.mtimeMs === before.mtimeMs;
  report.playerFolder = existsSync(join(folder, '.player'));
  writeFileSync(join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2));

  expect(after.mtimeMs).toBe(before.mtimeMs);
  expect(existsSync(join(folder, '.player'))).toBe(false);
});
