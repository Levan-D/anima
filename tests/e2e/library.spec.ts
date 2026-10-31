import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import type { ScanState } from '@shared/domain';

const ROOT = resolve(import.meta.dirname, '../..');
const E2E = join(ROOT, '.dev', 'e2e-library');
const USER_DATA = join(E2E, 'user-data');
const DATA_ROOT = join(E2E, 'data');
const MUSIC = join(E2E, 'Music');
const FFMPEG = join(ROOT, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');

const { CHROME_CRASHPAD_PIPE_NAME: _parentCrashHandler, ...parentEnv } = process.env;

let app: ElectronApplication;
let page: Page;

function ffmpeg(...args: string[]): void {
  execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { windowsHide: true });
}

function tone(path: string, frequency: number, tags: Record<string, string>, picture?: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  ffmpeg(
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${frequency}:duration=0.4`,
    ...(picture ? ['-i', picture, '-map', '0:a', '-map', '1:v', '-c:v', 'copy', '-disposition:v', 'attached_pic'] : []),
    ...Object.entries(tags).flatMap(([key, value]) => ['-metadata', `${key}=${value}`]),
    path,
  );
}

function generateLibrary(): void {
  mkdirSync(MUSIC, { recursive: true });
  const cover = join(E2E, 'cover.png');
  ffmpeg('-f', 'lavfi', '-i', 'color=c=red:s=800x800', '-frames:v', '1', cover);
  const album = { artist: 'Björk', album: 'Homogenic', date: '1997', genre: 'Electronic' };
  tone(join(MUSIC, 'Björk', 'Homogenic', 'Jóga.flac'), 300, { ...album, title: 'Jóga', track: '1' }, cover);
  tone(join(MUSIC, 'Björk', 'Homogenic', 'Hunter.flac'), 330, { ...album, title: 'Hunter', track: '2' }, cover);
  tone(join(MUSIC, 'The Beatles', 'Single.mp3'), 360, { artist: 'The Beatles', title: 'Single', genre: 'Rock' });
  tone(join(MUSIC, 'No Tags', 'untagged.flac'), 390, {});
  mkdirSync(join(MUSIC, 'Broken'), { recursive: true });
  writeFileSync(join(MUSIC, 'Broken', 'corrupt.flac'), 'this is not a flac file at all');
}

function snapshot(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      const { size, mtimeMs } = statSync(path);
      return `${path}|${size}|${mtimeMs}`;
    })
    .toSorted();
}

function launch() {
  return electron.launch({
    args: ['.', `--user-data-dir=${USER_DATA}`],
    cwd: ROOT,
    artifactsDir: join(E2E, 'artifacts'),
    env: { ...parentEnv, MUSIC_PLAYER_DATA_DIR: DATA_ROOT, MUSIC_PLAYER_MPV_ARGS: '--ao=null' },
  });
}

async function start(): Promise<void> {
  app = await launch();
  page = await app.firstWindow();
  await page.waitForLoadState('load');
}

function stubDialog(folder: string | null) {
  return app.evaluate(({ dialog }, picked) => {
    const answer = { canceled: picked === null, filePaths: picked === null ? [] : [picked] };
    dialog.showOpenDialog = () => Promise.resolve(answer);
  }, folder);
}

function invoke<T = unknown>(name: string, input?: unknown): Promise<T> {
  return page.evaluate(
    ([command, value]) => (window.api.invoke as (name: unknown, input?: unknown) => Promise<unknown>)(command, value),
    [name, input],
  ) as Promise<T>;
}

async function value<T>(name: string, input?: unknown): Promise<T> {
  const result = await invoke<{ ok: boolean; value: T; error?: unknown }>(name, input);
  expect(result, name).toMatchObject({ ok: true });
  return result.value;
}

async function waitForScan(): Promise<ScanState> {
  await expect.poll(async () => (await value<ScanState>('scan.state')).phase, { timeout: 60_000 }).toBe('idle');
  return value<ScanState>('scan.state');
}

function fetchArt(url: string) {
  return page.evaluate(async (target) => {
    const response = await fetch(target);
    return {
      status: response.status,
      type: response.headers.get('content-type'),
      cache: response.headers.get('cache-control'),
      bytes: (await response.arrayBuffer()).byteLength,
    };
  }, url);
}

type TrackRow = {
  id: number;
  title: string;
  artist: string;
  album: string | null;
  artHash: string | null;
  artColor: string | null;
  relPath: string;
};

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  rmSync(E2E, { recursive: true, force: true });
  mkdirSync(E2E, { recursive: true });
  generateLibrary();
  await start();
});

test.afterAll(async () => {
  await app.close();
});

test('with no folder, the library says so, and nothing else is a surprise', async () => {
  expect(await value('library.status')).toEqual({ state: 'no-folder' });
  expect(await invoke('library.artists')).toMatchObject({ ok: false, error: { code: 'no_library' } });
  expect(await invoke('library.rebuild')).toMatchObject({ ok: false, error: { code: 'no_library' } });
  expect(await invoke('scan.start')).toMatchObject({ ok: false, error: { code: 'no_library' } });
  expect(await value('scan.state')).toMatchObject({ phase: 'idle', lastReport: null });
  expect((await fetchArt('art://thumb/0123456789abcdef')).status).toBe(404);
});

test('cancelling the dialog changes nothing', async () => {
  await stubDialog(null);
  expect(await value('library.chooseFolder')).toEqual({ state: 'no-folder' });
  expect(await value('settings.get')).toMatchObject({ libraryFolder: null });
});

test('opens a generated library through the dialog, and scans it with progress', async () => {
  const before = snapshot(MUSIC);
  await page.evaluate(() => {
    const seen: { scan: string[]; status: string[]; notices: unknown[]; changed: number } = {
      scan: [],
      status: [],
      notices: [],
      changed: 0,
    };
    Object.assign(window, { seen });
    window.api.on('scan.state', ({ phase }) => seen.scan.push(phase));
    window.api.on('library.status', ({ state }) => seen.status.push(state));
    window.api.on('notice', (notice) => seen.notices.push(notice));
    window.api.on('library.changed', () => {
      seen.changed++;
    });
  });

  await stubDialog(MUSIC);
  const status = await value('library.chooseFolder');
  expect(status).toMatchObject({ state: 'ready', folder: MUSIC, isEmpty: true });

  const { lastReport } = await waitForScan();
  expect(lastReport).toMatchObject({ added: 4, cancelled: false, nowMissing: 0, issues: 2 });
  expect(await value('library.status')).toMatchObject({ state: 'ready', isEmpty: false, changedElsewhere: false });
  expect(await value('settings.get')).toMatchObject({ libraryFolder: MUSIC });

  const seen = await page.evaluate(
    () =>
      (window as unknown as { seen: { scan: string[]; status: string[]; notices: unknown[]; changed: number } }).seen,
  );
  expect(seen.scan).toEqual(expect.arrayContaining(['walking', 'reading', 'hashing', 'writing', 'art', 'idle']));
  expect(seen.status).toContain('ready');
  expect(seen.changed).toBeGreaterThanOrEqual(1);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { seen: { notices: unknown[] } }).seen.notices))
    .toEqual([
      {
        id: expect.any(Number),
        level: 'info',
        message: 'Scan finished: 4 added, 2 with issues',
        action: { kind: 'open-storage', label: 'See issues' },
      },
    ]);

  expect(snapshot(MUSIC)).toEqual(before);
  expect(existsSync(join(MUSIC, '.player'))).toBe(false);
});

test('serves the library over IPC', async () => {
  const artists = await value<{ name: string }[]>('library.artists');
  expect(artists.map(({ name }) => name)).toEqual(['The Beatles', 'Björk', 'Unknown Artist']);

  const albums = await value<{ title: string; artist: string; year: number; trackCount: number }[]>('library.albums', {
    artistId: null,
    genreId: null,
  });
  expect(albums).toMatchObject([{ title: 'Homogenic', artist: 'Björk', year: 1997, trackCount: 2 }]);

  const tracks = await value<TrackRow[]>('library.tracks', { filter: { kind: 'all' } });
  expect(tracks.map(({ title }) => title)).toEqual(['Single', 'Jóga', 'Hunter', 'untagged']);

  expect((await value<{ name: string }[]>('library.genres')).map(({ name }) => name)).toEqual(['Electronic', 'Rock']);

  const issues = await value<{ relPath: string; kind: string }[]>('scan.issues');
  expect(issues.map(({ relPath, kind }) => [relPath, kind])).toEqual([
    ['No Tags/untagged.flac', 'bad_tags'],
    ['Broken/corrupt.flac', 'unreadable'],
  ]);

  const found = await value<{ artists: { name: string }[]; albums: unknown[]; tracks: TrackRow[] }>('library.search', {
    query: 'bjork',
  });
  expect(found.artists.map(({ name }) => name)).toEqual(['Björk']);
  expect(found.tracks).toHaveLength(2);
  expect(await value('library.search', { query: '"*(' })).toMatchObject({ artists: [], albums: [], tracks: [] });
  expect(await invoke('library.artist', { artistId: 99999 })).toMatchObject({
    ok: false,
    error: { code: 'not_found' },
  });
  expect(await invoke('library.album', { albumId: 99999 })).toMatchObject({ ok: false, error: { code: 'not_found' } });
});

test('serves art with the right type and a long cache, and 404s what it does not know', async () => {
  const tracks = await value<TrackRow[]>('library.tracks', { filter: { kind: 'all' } });
  const hash = tracks.find(({ title }) => title === 'Jóga')?.artHash ?? '';
  expect(hash).toMatch(/^[0-9a-f]{40}$/);
  expect(tracks.find(({ title }) => title === 'Jóga')?.artColor).toMatch(/^#[0-9a-f]{6}$/);

  const thumb = await fetchArt(`art://thumb/${hash}`);
  expect(thumb).toMatchObject({ status: 200, type: 'image/jpeg' });
  expect(thumb.cache).toContain('immutable');
  expect(thumb.bytes).toBeGreaterThan(0);

  const full = await fetchArt(`art://full/${hash}`);
  expect(full).toMatchObject({ status: 200, type: 'image/png' });
  expect(full.bytes).toBeGreaterThan(0);

  const shown = await page.evaluate(async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  }, `art://thumb/${hash}`);
  expect(shown).toEqual({ width: 512, height: 512 });

  expect((await fetchArt('art://thumb/0123456789abcdef')).status).toBe(404);
  expect((await fetchArt('art://huge/nope')).status).toBe(404);
  expect((await fetchArt(`art://thumb/${hash}/../..`)).status).toBe(404);

  const cacheFiles = readdirSync(join(USER_DATA, 'art-cache', hash.slice(0, 2)));
  expect(cacheFiles.toSorted()).toEqual([`${hash}.png`, `${hash}.thumb.jpg`]);
});

test('the storage screen has the real numbers', async () => {
  const info = await value<Record<string, unknown>>('system.storageInfo');
  expect(info).toMatchObject({
    libraryFolder: MUSIC,
    databasePath: expect.stringContaining(DATA_ROOT),
    databaseBytes: expect.any(Number),
    cachePath: join(USER_DATA, 'art-cache'),
    settingsPath: join(USER_DATA, 'settings.json'),
    logsPath: join(USER_DATA, 'logs'),
    counts: { tracks: 4, albums: 1, artists: 3, missing: 0 },
    lastScanAt: expect.any(Number),
    lastChanged: { host: expect.any(String), at: expect.any(Number) },
    thisMachine: expect.any(String),
    engine: {
      mpvPath: expect.stringContaining('mpv.exe'),
      mpvFound: true,
      mpvVersion: 'v0.41.0',
      ffmpegPath: expect.stringContaining('ffmpeg.exe'),
      ffmpegFound: true,
    },
  });
  expect(info.cacheBytes).toBeGreaterThan(0);
  expect(info.thisMachine).toBe((info.lastChanged as { host: string }).host);
});

test('reveal only touches what main resolved', async () => {
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
  const calls = () => app.evaluate(() => (globalThis as unknown as { revealCalls: string[] }).revealCalls);

  const tracks = await value<TrackRow[]>('library.tracks', { filter: { kind: 'all' } });
  const single = tracks.find(({ title }) => title === 'Single');
  await value('system.revealTrack', { trackId: single?.id });
  expect(await calls()).toEqual([`show:${join(MUSIC, 'The Beatles', 'Single.mp3')}`]);

  for (const target of ['library', 'database', 'cache', 'logs', 'settings']) {
    await value('system.revealPath', { target });
  }
  expect((await calls()).slice(1, 3)).toEqual([`open:${MUSIC}`, expect.stringMatching(/^show:.*library\.db$/)]);

  expect(await invoke('system.revealTrack', { trackId: 99999 })).toMatchObject({
    ok: false,
    error: { code: 'file_missing' },
  });
  expect(await invoke('system.revealPath', { target: 'C:\\Windows' })).toMatchObject({
    ok: false,
    error: { code: 'invalid_input' },
  });
});

test('a rescan with nothing new changes nothing, and refuses to overlap', async () => {
  const before = await value<{ lastChanged: unknown }>('library.status');
  await value('scan.start');
  expect(await invoke('scan.start')).toMatchObject({ ok: false, error: { code: 'scan_running' } });
  const { lastReport } = await waitForScan();
  expect(lastReport).toMatchObject({ added: 0, updated: 0, unchanged: 4 });
  expect(await value('library.status')).toEqual(before);
});

test('a deleted file goes missing and stays findable, until it is removed on purpose', async () => {
  const backup = join(E2E, 'hunter-backup.flac');
  const hunter = join(MUSIC, 'Björk', 'Homogenic', 'Hunter.flac');
  cpSync(hunter, backup);
  rmSync(hunter);

  await value('scan.start');
  expect((await waitForScan()).lastReport).toMatchObject({ nowMissing: 1 });

  const missing = await value<TrackRow[]>('library.tracks', { filter: { kind: 'missing' } });
  expect(missing.map(({ title }) => title)).toEqual(['Hunter']);
  expect(await value<TrackRow[]>('library.tracks', { filter: { kind: 'all' } })).toHaveLength(3);
  // The folder it was in, since the file isn't there to show. Not really opened: that would put a window on the desktop.
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    Object.assign(globalThis, { opened });
    shell.openPath = (path) => {
      opened.push(path);
      return Promise.resolve('');
    };
  });
  expect(await invoke('system.revealTrack', { trackId: missing[0]?.id })).toMatchObject({ ok: true });
  expect(await app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened)).toEqual([dirname(hunter)]);

  expect(await value('library.removeMissing')).toEqual({ removed: 1 });
  expect(await value<TrackRow[]>('library.tracks', { filter: { kind: 'missing' } })).toEqual([]);

  cpSync(backup, hunter);
  await value('scan.start');
  expect((await waitForScan()).lastReport).toMatchObject({ added: 1 });
});

test('quits cleanly, with a complete database and no workers left, and comes back ready', async () => {
  const { databasePath } = await value<{ databasePath: string }>('system.storageInfo');
  const before = await value('library.status');
  await app.close();

  expect(existsSync(`${databasePath}-wal`)).toBe(false);
  expect(existsSync(`${databasePath}-shm`)).toBe(false);
  expect(readFileSync(databasePath).length).toBeGreaterThan(0);

  await start();
  // Ready by the time the first command can be asked: the library opens before the window.
  expect(await value('library.status')).toEqual(before);
  expect(await value<TrackRow[]>('library.tracks', { filter: { kind: 'all' } })).toHaveLength(4);
  // The last scan's report came back with the database.
  expect(await value('scan.state')).toMatchObject({ phase: 'idle', lastReport: { added: 1 } });
});

test('a damaged database gets the screen, with a way out, and is never deleted', async () => {
  const { databasePath } = await value<{ databasePath: string }>('system.storageInfo');
  await app.close();

  writeFileSync(databasePath, 'garbage '.repeat(2000));
  await start();

  expect(await value('library.status')).toMatchObject({
    state: 'db-corrupt',
    folder: MUSIC,
    backupAt: expect.any(Number),
  });
  expect(await invoke('library.artists')).toMatchObject({ ok: false, error: { code: 'db_corrupt' } });

  const restored = await value('library.restoreBackup');
  expect(restored).toMatchObject({ state: 'ready', folder: MUSIC, isEmpty: false });

  const names = readdirSync(join(databasePath, '..'));
  const aside = names.find((name) => /^library\.bad-.*\.db$/.test(name)) ?? '';
  expect(readFileSync(join(databasePath, '..', aside), 'utf8')).toContain('garbage');

  const rebuilt = await value('library.rebuild');
  expect(rebuilt).toMatchObject({ state: 'ready', isEmpty: true });
  expect((await waitForScan()).lastReport).toMatchObject({ added: 4 });
  expect(await value<TrackRow[]>('library.tracks', { filter: { kind: 'all' } })).toHaveLength(4);
});

test('killed in the middle of a scan, it comes back with nothing marked missing, and carries on', async () => {
  const source = join(MUSIC, 'The Beatles', 'Single.mp3');
  const many = join(MUSIC, 'Many');
  mkdirSync(many);
  for (let index = 0; index < 400; index++) cpSync(source, join(many, `copy ${index}.mp3`));

  await value('scan.start');
  await expect
    .poll(async () => (await value<ScanState>('scan.state')).phase, { timeout: 30_000, intervals: [5] })
    .toMatch(/reading|hashing/);
  // app.process() is the launcher here, so this asks the app which process is the real one.
  process.kill(await app.evaluate(() => process.pid), 'SIGKILL');
  await new Promise((done) => setTimeout(done, 1000));

  await start();
  expect(await value('library.status')).toMatchObject({ state: 'ready' });
  expect(await value<TrackRow[]>('library.tracks', { filter: { kind: 'missing' } })).toEqual([]);

  await value('scan.start');
  expect((await waitForScan()).lastReport).toMatchObject({ nowMissing: 0, cancelled: false });
  expect(await value<TrackRow[]>('library.tracks', { filter: { kind: 'all' } })).toHaveLength(404);
  expect(await value<TrackRow[]>('library.tracks', { filter: { kind: 'missing' } })).toEqual([]);
});

test('a scan can be cancelled, and quitting during one is clean', async () => {
  const { databasePath } = await value<{ databasePath: string }>('system.storageInfo');
  await value('library.rebuild');
  await value('scan.cancel');
  expect((await waitForScan()).lastReport).toMatchObject({ cancelled: true, nowMissing: 0 });

  await value('scan.start');
  await app.close();
  expect(existsSync(`${databasePath}-wal`)).toBe(false);

  await start();
  expect(await value('library.status')).toMatchObject({ state: 'ready' });
});
