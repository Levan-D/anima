/*
 * The Player through the whole app: real Electron, real IPC, real mpv with --ao=null, on a small generated library.
 * Nothing here makes a sound. Writes to .dev/e2e-player/.
 */
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import type { CommandName } from '@shared/ipc/channels';
import type { Notice, PlayerPosition, PlayerState, QueueItem, ScanState, Track } from '@shared/domain';
import { launchApp, ROOT, stubFolderDialog } from './helpers/app';

const OUTPUT = join(ROOT, '.dev', 'e2e-player');
const MUSIC = join(OUTPUT, 'Music');
const FFMPEG = join(ROOT, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
const SECONDS = 12;

const run = promisify(execFile);

test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let page: Page;
let tracks: Track[];
let electronPid: number;

async function invoke(name: CommandName, input?: unknown): Promise<unknown> {
  return page.evaluate(
    ([command, args]) =>
      (window.api.invoke as (...values: unknown[]) => Promise<unknown>)(command, ...(args === undefined ? [] : [args])),
    [name, input] as const,
  );
}

async function value<T>(name: CommandName, input?: unknown): Promise<T> {
  const result = (await invoke(name, input)) as { ok: true; value: T } | { ok: false; error: { message: string } };
  if (!result.ok) throw new Error(`${name}: ${result.error.message}`);
  return result.value;
}

const state = () => value<PlayerState>('player.state');
const position = () => value<PlayerPosition>('player.position');

function until(check: (current: PlayerState) => boolean, timeout = 15_000) {
  return expect.poll(async () => check(await state()), { timeout, intervals: [20] }).toBe(true);
}

const status = (expected: PlayerState['status']) => until((current) => current.status === expected);

/** The mpv processes this app started. There can be others on the machine, which aren't this test's to touch. */
function mpvPids(): number[] {
  const output = execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "ParentProcessId=${electronPid} AND Name='mpv.exe'" | ForEach-Object { $_.ProcessId }`,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  return output.split(/\s+/).filter(Boolean).map(Number);
}

async function tone(path: string, frequency: number, title: string) {
  mkdirSync(join(path, '..'), { recursive: true });
  await run(
    FFMPEG,
    [
      '-nostdin',
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=${frequency}:duration=${SECONDS}`,
      '-ac',
      '2',
      '-metadata',
      `title=${title}`,
      '-metadata',
      'artist=Test Artist',
      '-metadata',
      'album=Test Album',
      '-metadata',
      `track=${title.at(-1)}`,
      '-metadata',
      'REPLAYGAIN_TRACK_GAIN=-3.00 dB',
      path,
    ],
    { windowsHide: true },
  );
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  rmSync(OUTPUT, { recursive: true, force: true });
  await Promise.all(
    [300, 400, 500, 600].map((frequency, index) =>
      tone(join(MUSIC, `0${index + 1} Track ${index + 1}.flac`), frequency, `Track ${index + 1}`),
    ),
  );

  app = await launchApp({ userData: join(OUTPUT, 'user-data'), dataRoot: join(OUTPUT, 'data') });
  page = await app.firstWindow();
  await page.waitForLoadState('load');
  electronPid = await app.evaluate(() => process.pid);

  await stubFolderDialog(app, MUSIC);
  await value('library.chooseFolder');
  await expect
    .poll(async () => (await value<ScanState>('scan.state')).phase, { timeout: 60_000, intervals: [50] })
    .toBe('idle');
  tracks = await value<Track[]>('library.tracks', { filter: { kind: 'all' } });
  expect(tracks).toHaveLength(4);

  // What the UI will do: hold on to everything main sends.
  await page.evaluate(() => {
    const seen: { states: PlayerState[]; positions: PlayerPosition[]; notices: Notice[] } = {
      states: [],
      positions: [],
      notices: [],
    };
    Object.assign(window, { seen });
    window.api.on('player.state', (next) => seen.states.push(next));
    window.api.on('player.position', (next) => seen.positions.push(next));
    window.api.on('notice', (next) => seen.notices.push(next));
  });
});

test.afterAll(async () => {
  await app.close();
});

type Seen = { states: PlayerState[]; positions: PlayerPosition[]; notices: Notice[] };
const seen = () => page.evaluate(() => (window as unknown as { seen: Seen }).seen);
const forget = () =>
  page.evaluate(() => {
    const { seen: all } = window as unknown as { seen: Seen };
    all.states.length = 0;
    all.positions.length = 0;
    all.notices.length = 0;
  });

test('starts mpv with the app, idle, with one process', async () => {
  expect(await state()).toMatchObject({ status: 'idle', current: null, error: null, queueLength: 0 });
  expect(mpvPids()).toHaveLength(1);
  expect(await value('player.queue')).toEqual([]);
  expect(await position()).toMatchObject({ positionMs: 0 });
});

test('plays through IPC, with state and position arriving as events', async () => {
  await forget();
  const ids = tracks.map(({ id }) => id);
  expect(await invoke('player.play', { trackIds: ids, startIndex: 0 })).toEqual({ ok: true });
  await status('playing');
  await page.waitForTimeout(1200);

  const { states, positions } = await seen();
  expect(states.at(0)).toMatchObject({ status: 'loading', queueLength: 4, queueIndex: 0 });
  const last = states.at(-1) as PlayerState;
  expect(last).toEqual(await state());
  expect(last.status).toBe('playing');
  expect(last.current?.title).toBe('Track 1');
  expect(last.signal.decoded).toMatchObject({ sampleRate: 44_100, channels: 2 });

  // About five a second, and in order.
  expect(positions.length).toBeGreaterThanOrEqual(3);
  expect(positions.length).toBeLessThanOrEqual(9);
  const times = positions.map(({ positionMs }) => positionMs);
  expect(times).toEqual(times.toSorted((a, b) => a - b));
  expect(states.length).toBeLessThanOrEqual(8);

  const queue = await value<QueueItem[]>('player.queue');
  expect(queue.map(({ track }) => track.title)).toEqual(['Track 1', 'Track 2', 'Track 3', 'Track 4']);
  expect(new Set(queue.map(({ queueId }) => queueId)).size).toBe(4);
  expect(Object.keys(queue[0] as QueueItem).sort()).toEqual(['queueId', 'track']);
});

test('pauses and seeks', async () => {
  await invoke('player.pause');
  await status('paused');
  const pausedAt = (await position()).positionMs;
  await page.waitForTimeout(300);
  expect((await position()).positionMs).toBe(pausedAt);

  await forget();
  await invoke('player.seek', { positionMs: 5000 });
  await page.waitForTimeout(300);
  expect((await position()).positionMs).toBe(5000);
  expect((await seen()).positions.at(-1)?.positionMs).toBe(5000);

  await invoke('player.toggle');
  await status('playing');
  await page.waitForTimeout(400);
  expect((await position()).positionMs).toBeGreaterThan(5000);

  expect(await invoke('player.seek', { positionMs: -1 })).toMatchObject({
    ok: false,
    error: { code: 'invalid_input' },
  });
});

test('edits the queue around what is playing, without interrupting it', async () => {
  const before = await state();
  const queue = await value<QueueItem[]>('player.queue');
  await invoke('player.moveInQueue', { queueIds: [queue[3]?.queueId], toIndex: 1 });
  await invoke('player.enqueue', { trackIds: [tracks[0]?.id], where: 'next' });
  await invoke('player.removeFromQueue', { queueIds: [queue[1]?.queueId] });
  const after = await state();
  expect(after.loadId).toBe(before.loadId);
  expect(after.status).toBe('playing');
  expect(after.queueVersion).toBeGreaterThan(before.queueVersion);

  const edited = await value<QueueItem[]>('player.queue');
  expect(edited.map(({ track }) => track.title)).toEqual(['Track 1', 'Track 1', 'Track 4', 'Track 3']);
});

test('moves with next, previous and a jump', async () => {
  const before = await state();
  await invoke('player.next');
  await until((current) => current.status === 'playing' && current.queueIndex === 1);
  expect((await state()).loadId).toBeGreaterThan(before.loadId);

  await invoke('player.next');
  await until((current) => current.status === 'playing' && current.current?.title === 'Track 4');
  await invoke('player.previous');
  await until((current) => current.status === 'playing' && current.queueIndex === 1);
  await invoke('player.playQueueIndex', { index: 3 });
  await until((current) => current.status === 'playing' && current.current?.title === 'Track 3');
  expect(await invoke('player.playQueueIndex', { index: 99 })).toMatchObject({
    ok: false,
    error: { code: 'not_found' },
  });
});

test('saves settings, and tells the truth about the signal', async () => {
  await invoke('player.setReplayGainMode', { mode: 'track' });
  await invoke('player.setOutputMode', { mode: 'shared' });
  await until((current) => current.signal.alterations.includes('ReplayGain is changing the level'));
  expect((await state()).signal.alterations).toEqual(expect.arrayContaining(['Windows is mixing']));

  await invoke('player.setVolume', { volume: 40 });
  await invoke('player.setMuted', { muted: true });
  await invoke('player.setOutputMode', { mode: 'exclusive' });
  await invoke('player.setReplayGainMode', { mode: 'off' });
  expect(await value('settings.get')).toMatchObject({
    volume: 40,
    muted: true,
    outputMode: 'exclusive',
    replayGainMode: 'off',
  });
  expect((await state()).signal.alterations).toEqual(['Volume is below 100', 'Muted']);

  await invoke('player.setVolume', { volume: 100 });
  await invoke('player.setMuted', { muted: false });
  await until((current) => current.signal.isBitPerfect);
});

test('comes back from a killed mpv at the same place, saying nothing', async () => {
  await invoke('player.playQueueIndex', { index: 0 });
  await until((current) => current.status === 'playing' && current.queueIndex === 0);
  await invoke('player.seek', { positionMs: 6000 });
  await page.waitForTimeout(300);
  await forget();

  const [pid] = mpvPids();
  const before = await position();
  const { loadId } = await state();
  execFileSync('taskkill', ['/F', '/PID', String(pid)], { windowsHide: true, stdio: 'ignore' });

  await until((current) => current.status === 'playing' && current.loadId > loadId);
  await page.waitForTimeout(300);
  const after = await position();
  expect(after.positionMs).toBeGreaterThanOrEqual(before.positionMs);
  expect(after.positionMs).toBeLessThan(before.positionMs + 3000);
  expect((await state()).outputMode).toBe('exclusive');

  const { states, notices } = await seen();
  expect(notices).toEqual([]);
  expect(states.every(({ error }) => error === null)).toBe(true);
  expect(mpvPids()).not.toContain(pid);
  expect(mpvPids()).toHaveLength(1);
});

test('skips a file that has gone, says so, and can show where it was', async () => {
  const third = join(MUSIC, '03 Track 3.flac');
  const hidden = `${third}.hidden`;
  renameSync(third, hidden);
  await forget();
  try {
    await invoke('player.play', { trackIds: [tracks[2]?.id, tracks[3]?.id], startIndex: 0 });
    await until((current) => current.status === 'playing' && current.current?.title === 'Track 4');

    const { notices } = await seen();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      level: 'warning',
      action: { kind: 'reveal-track', trackId: tracks[2]?.id, label: 'Reveal' },
    });
    const queue = await value<QueueItem[]>('player.queue');
    expect(queue[0]?.track.isMissing).toBe(true);

    await app.evaluate(({ shell }) => {
      const opened: string[] = [];
      Object.assign(globalThis, { opened });
      shell.openPath = (path) => {
        opened.push(path);
        return Promise.resolve('');
      };
    });
    expect(await invoke('system.revealTrack', { trackId: tracks[2]?.id })).toEqual({ ok: true });
    expect(await app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened)).toEqual([MUSIC]);
  } finally {
    renameSync(hidden, third);
    await value('scan.start');
    await expect
      .poll(async () => (await value<ScanState>('scan.state')).phase, { timeout: 60_000, intervals: [50] })
      .toBe('idle');
  }
});

test('ends the queue keeping the last track, and starts over from the top', async () => {
  await invoke('player.play', { trackIds: [tracks[0]?.id], startIndex: 0 });
  await status('playing');
  await invoke('player.seek', { positionMs: SECONDS * 1000 });
  await status('ended');
  expect((await state()).current?.title).toBe('Track 1');
  await invoke('player.toggle');
  await status('playing');
  expect((await position()).positionMs).toBeLessThan(2000);
});

test('drops the queue when another folder opens', async () => {
  const other = join(OUTPUT, 'Other');
  await tone(join(other, 'Other.flac'), 700, 'Other 1');
  await stubFolderDialog(app, other);
  await value('library.chooseFolder');
  await until((current) => current.status === 'idle' && current.queueLength === 0 && current.current === null);
  expect(await value('player.queue')).toEqual([]);
});

// This crashes the page, so everything that uses `page` has to stay above it.
test('keeps playing through a renderer crash, which main still hears about', async () => {
  const log = () => readFileSync(join(OUTPUT, 'user-data', 'logs', 'main.log'), 'utf8');
  await expect
    .poll(async () => (await value<ScanState>('scan.state')).phase, { timeout: 60_000, intervals: [50] })
    .toBe('idle');
  const others = await value<Track[]>('library.tracks', { filter: { kind: 'all' } });
  expect(await invoke('player.play', { trackIds: [others[0]?.id], startIndex: 0 })).toEqual({ ok: true });
  await status('playing');
  const before = await state();
  const [pid] = mpvPids();

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.forcefullyCrashRenderer();
  });
  await expect.poll(log, { timeout: 5000 }).toContain('Renderer gone');

  // The page Playwright knows is gone, so what comes back is asked through main.
  const askThePage = () =>
    app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]?.webContents;
      if (!contents || contents.isCrashed() || contents.isLoading()) return null;
      return contents.executeJavaScript('window.api.invoke("player.state")').catch(() => null) as Promise<{
        value: PlayerState;
      } | null>;
    });
  await expect.poll(async () => (await askThePage())?.value.status, { timeout: 15_000 }).toBe('playing');
  expect((await askThePage())?.value.loadId).toBe(before.loadId);
  expect(mpvPids()).toEqual([pid]);
});

test('takes mpv with it when it quits, without waiting for it', async () => {
  const log = () => readFileSync(join(OUTPUT, 'user-data', 'logs', 'main.log'), 'utf8');
  expect(log()).not.toContain('Keeping mpv in line failed');
  const [pid] = mpvPids();
  await app.close();
  await expect
    .poll(
      () => {
        const output = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
          encoding: 'utf8',
          windowsHide: true,
        });
        return output.includes('mpv.exe');
      },
      { timeout: 5000 },
    )
    .toBe(false);

  // The next test run's afterAll closes this again, which is harmless, so the file ends with a fresh launch.
  app = await launchApp({ userData: join(OUTPUT, 'user-data'), dataRoot: join(OUTPUT, 'data') });
  page = await app.firstWindow();
  await page.waitForLoadState('load');
  // The last queue comes back paused: a launch never starts the sound by itself.
  const relaunched = await state();
  expect(relaunched).toMatchObject({ outputMode: 'exclusive', volume: 100 });
  expect(['idle', 'paused']).toContain(relaunched.status);
});
