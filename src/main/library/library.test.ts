import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryStatus, Notice, ScanReport, ScanState } from '@shared/domain';
import { createBackup, listBackups } from '@main/db/backups';
import { connect, type Connection } from '@main/db/connection';
import type { MaintenanceEvent, MaintenanceRunner } from '@main/db/maintenance';
import { MIGRATIONS } from '@main/db/migrations';
import { closeCleanly, openDatabase } from '@main/db/open';
import { createArtCache } from '@main/library/artCache';
import { libraryPaths } from '@main/library/dataDir';
import { createLibrary, type Library, type LibraryDeps } from '@main/library/library';
import { toAbsolute } from '@main/library/relPath';
import type { ScanEvent, ScanRunner } from '@main/library/scanner';
import {
  artInProcess,
  BASE_FILES_READABLE,
  copyOfBaseLibrary,
  FFMPEG,
  maintenanceInProcess,
  scanInProcess,
  tempDir,
} from '@main/library/testFixtures';

// Real files and real ffmpeg, on a machine shared with every other test file.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const LATEST = MIGRATIONS.at(-1)?.version ?? 0;

let dataRoot: string;
let cacheDir: string;
let libraries: Library[];

type Harness = {
  library: Library;
  statuses: LibraryStatus[];
  scanStates: ScanState[];
  changed: string[][];
  notices: Notice[];
  /** The order the two status events went out in. */
  order: string[];
  folder: { current: string | null };
  picks: (string | null)[];
  artWorkers: () => number;
};

function harness(initialFolder: string | null, overrides: Partial<LibraryDeps> = {}): Harness {
  const statuses: LibraryStatus[] = [];
  const scanStates: ScanState[] = [];
  const changed: string[][] = [];
  const notices: Notice[] = [];
  const order: string[] = [];
  const folder = { current: initialFolder };
  const picks: (string | null)[] = [];
  const art = artInProcess();
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  const library = createLibrary({
    settings: {
      get: () => ({ libraryFolder: folder.current }),
      update: ({ libraryFolder }) => {
        folder.current = libraryFolder;
      },
    },
    emit: (event, payload) => {
      if (event === 'library.status') {
        statuses.push(payload as LibraryStatus);
        order.push((payload as LibraryStatus).state);
      }
      if (event === 'scan.state') {
        scanStates.push(payload as ScanState);
        order.push((payload as ScanState).phase);
      }
      if (event === 'library.changed') changed.push((payload as { scopes: string[] }).scopes);
    },
    notify: (level, message, action) => notices.push({ id: notices.length, level, message, action }),
    log,
    pickFolder: () => Promise.resolve(picks.shift() ?? null),
    devDataRoot: dataRoot,
    hostname: 'this-machine',
    now: Date.now,
    art: createArtCache({ cacheDir, ffmpegPath: FFMPEG, start: art.start, log }),
    runScan: scanInProcess(),
    runMaintenance: maintenanceInProcess(),
    artPassDelayMs: 60_000,
    ...overrides,
  });
  libraries.push(library);
  return { library, statuses, scanStates, changed, notices, order, folder, picks, artWorkers: art.started };
}

async function scanned({ library, scanStates }: Harness): Promise<ScanState> {
  await vi.waitFor(() => expect(library.scanState().phase).toBe('idle'), { timeout: 60_000, interval: 20 });
  return scanStates.at(-1) as ScanState;
}

function pathsOf(folder: string) {
  return libraryPaths(folder, dataRoot);
}

function isOpen(library: Library): boolean {
  return library.read(() => true).ok;
}

function sql(library: Library, text: string): unknown {
  const result = library.perConnection((db) => db)((db) => db.prepare(text).get());
  return result.ok ? result.value : null;
}

const CANCELLED_REPORT: ScanReport = {
  finishedAt: 1,
  durationMs: 1,
  cancelled: true,
  looksEmpty: false,
  added: 0,
  updated: 0,
  moved: 0,
  nowMissing: 0,
  restored: 0,
  unchanged: 0,
  issues: 0,
};

/** A scan that does nothing until told to, so what happens around it can be looked at. */
function heldScan() {
  let send: (event: ScanEvent) => void = () => {};
  const run: ScanRunner = (_job, onEvent) => {
    send = onEvent;
    return { cancel: () => {}, terminate: () => Promise.resolve() };
  };
  return {
    run,
    send: (event: ScanEvent) => send(event),
    finish: () => send({ type: 'done', outcome: { kind: 'cancelled', report: CANCELLED_REPORT } }),
  };
}

/** A maintenance runner that holds its stop until released. */
function heldMaintenance() {
  let release = (): void => {};
  const released = new Promise<void>((done) => {
    release = done;
  });
  const events: ((event: MaintenanceEvent) => void)[] = [];
  const stop = vi.fn(() => released);
  const run = vi.fn<MaintenanceRunner>((_job, onEvent) => {
    events.push(onEvent);
    return { stop };
  });
  return { run, stop, events, release };
}

/** A database with real rows, closed, the way a previous run would have left it. */
async function libraryWithData(folder: string): Promise<void> {
  const first = harness(folder);
  first.library.open();
  await scanned(first);
  await first.library.close();
}

/** Damages the data pages, leaving the header that says it's a database. */
function damage(path: string): void {
  const bytes = Buffer.from(readFileSync(path));
  const pageSize = bytes.readUInt16BE(16);
  for (let offset = pageSize * 2; offset < bytes.length; offset++) bytes[offset] = (offset * 31) & 0xff;
  writeFileSync(path, bytes);
}

beforeEach(() => {
  dataRoot = tempDir('library-data');
  cacheDir = tempDir('library-cache');
  libraries = [];
});

afterEach(async () => {
  for (const library of libraries) await library.close();
});

describe('the status flow', () => {
  it('asks for a folder when none is set', () => {
    const { library, statuses } = harness(null);
    library.open();
    expect(library.status()).toEqual({ state: 'no-folder' });
    expect(isOpen(library)).toBe(false);
    expect(statuses).toEqual([{ state: 'no-folder' }]);
  });

  it('says so when the folder is gone', () => {
    const folder = resolve('.dev/no-such-folder');
    const { library } = harness(folder);
    library.open();
    expect(library.status()).toEqual({ state: 'folder-missing', folder });
    expect(isOpen(library)).toBe(false);
  });

  it('says so when the folder is a file', () => {
    const file = join(tempDir('not-a-folder'), 'file');
    writeFileSync(file, '');
    const { library } = harness(file);
    library.open();
    expect(library.status()).toEqual({ state: 'folder-missing', folder: file });
  });

  it('says so when the data folder cannot be written', () => {
    const folder = tempDir('music');
    dataRoot = join(tempDir('blocked'), 'in-the-way');
    writeFileSync(dataRoot, '');
    const { library } = harness(folder);
    library.open();
    expect(library.status()).toEqual({ state: 'not-writable', folder, message: expect.any(String) as string });
    expect(isOpen(library)).toBe(false);
  });

  it('is ready when everything is there', () => {
    const folder = tempDir('music');
    const { library } = harness(folder);
    library.open();
    expect(library.status()).toEqual({
      state: 'ready',
      folder,
      isEmpty: true,
      lastChanged: null,
      changedElsewhere: false,
    });
    expect(isOpen(library)).toBe(true);
    expect(existsSync(pathsOf(folder).dbPath)).toBe(true);
  });

  it('never writes inside the music folder when a development root is set', () => {
    const folder = tempDir('music');
    const { library } = harness(folder);
    library.open();
    expect(readdirSync(folder)).toEqual([]);
  });

  it('writes to .player in a packaged run', () => {
    const folder = tempDir('music');
    const { library } = harness(folder, { devDataRoot: null });
    library.open();
    expect(existsSync(join(folder, '.player', 'library.db'))).toBe(true);
  });

  it('retries, and finds the folder once it is back', async () => {
    const parent = tempDir('music');
    const folder = join(parent, 'library');
    const away = join(parent, 'away');
    mkdirSync(away);
    const { library } = harness(folder);
    library.open();
    expect(library.status().state).toBe('folder-missing');

    renameSync(away, folder);
    expect((await library.retryOpen()).state).toBe('ready');
  });

  it('emits on every change, and only then', async () => {
    const folder = copyOfBaseLibrary('music');
    await libraryWithData(folder);
    const scan = heldScan();
    const { library, statuses } = harness(folder, { runScan: scan.run });
    library.open();
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.state).toBe('ready');

    library.startScan();
    scan.send({ type: 'committed' });
    scan.send({ type: 'committed' });
    expect(statuses).toHaveLength(1);
    scan.finish();
  });

  it('tells whoever asked about a change of status, until they stop asking', async () => {
    const folder = copyOfBaseLibrary('music');
    await libraryWithData(folder);
    const { library } = harness(folder);
    const heard: string[] = [];
    const stop = library.onStatus(({ state }) => heard.push(state));

    library.open();
    expect(heard).toEqual(['ready']);

    library.read(() => {
      throw Object.assign(new Error('malformed'), { code: 'SQLITE_CORRUPT' });
    });
    expect(heard).toEqual(['ready', 'db-corrupt']);

    stop();
    await library.retryOpen();
    expect(heard).toEqual(['ready', 'db-corrupt']);
  });

  it('notices when another machine changed the library last', () => {
    const folder = copyOfBaseLibrary('music');
    const { dbPath, backupsDir } = pathsOf(folder);
    mkdirSync(pathsOf(folder).dataDir, { recursive: true });
    const made = openDatabase(dbPath, { backupsDir, now: 1 });
    if (made.kind !== 'open') throw new Error('Could not make the database');
    made.db.prepare("INSERT INTO library_meta (key, value) VALUES ('last_changed_at', '12345')").run();
    made.db.prepare("INSERT INTO library_meta (key, value) VALUES ('last_changed_host', 'the-main-pc')").run();
    closeCleanly(made.db);

    const { library } = harness(folder);
    library.open();
    expect(library.status()).toMatchObject({
      state: 'ready',
      changedElsewhere: true,
      lastChanged: { host: 'the-main-pc', at: 12345 },
    });
  });

  it('does not count this machine as elsewhere', async () => {
    const folder = copyOfBaseLibrary('music');
    await libraryWithData(folder);
    const { library } = harness(folder);
    library.open();
    expect(library.status()).toMatchObject({
      state: 'ready',
      changedElsewhere: false,
      isEmpty: false,
      lastChanged: { host: 'this-machine' },
    });
  });
});

describe('a database that cannot be used', () => {
  it('reports a too-new database, and does not touch it', () => {
    const folder = tempDir('music');
    const { dbPath, backupsDir, dataDir } = pathsOf(folder);
    mkdirSync(dataDir, { recursive: true });
    const made = openDatabase(dbPath, { backupsDir, now: 1 });
    if (made.kind !== 'open') throw new Error('Could not make the database');
    made.db.pragma(`user_version = ${LATEST + 1}`);
    closeCleanly(made.db);
    const before = readFileSync(dbPath);

    const { library } = harness(folder);
    library.open();
    expect(library.status()).toEqual({ state: 'db-too-new', folder });
    expect(isOpen(library)).toBe(false);
    expect(readFileSync(dbPath)).toEqual(before);
  });

  it('reports a file that is not a database, knowing whether there is a backup', () => {
    const folder = tempDir('music');
    const { dbPath, dataDir } = pathsOf(folder);
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(dbPath, 'garbage '.repeat(1000));

    const { library } = harness(folder);
    library.open();
    expect(library.status()).toMatchObject({ state: 'db-corrupt', folder, cause: 'damaged', backupAt: null });
  });

  it('says what each kind of problem is, in its own words', () => {
    const folder = tempDir('music');
    const { dbPath, dataDir } = pathsOf(folder);
    mkdirSync(dataDir, { recursive: true });
    const other = new Database(dbPath);
    other.exec('CREATE TABLE theirs (a)');
    other.close();

    const { library } = harness(folder);
    library.open();
    expect(library.status()).toMatchObject({
      state: 'db-corrupt',
      cause: 'not-ours',
      message: expect.stringContaining("isn't a Music Player database") as string,
    });
  });

  it('reports damage to the schema itself, without throwing at startup', async () => {
    const folder = copyOfBaseLibrary('music');
    await libraryWithData(folder);
    const { dbPath } = pathsOf(folder);
    const bytes = Buffer.from(readFileSync(dbPath));
    bytes.fill(0xab, 100, bytes.readUInt16BE(16));
    writeFileSync(dbPath, bytes);

    const { library } = harness(folder);
    expect(() => library.open()).not.toThrow();
    expect(library.status()).toMatchObject({ state: 'db-corrupt', folder });
    expect(isOpen(library)).toBe(false);
  });

  it('offers the backup for any SQLite error while reading it, rather than failing to start', async () => {
    const folder = copyOfBaseLibrary('music');
    await libraryWithData(folder);
    const { dbPath, backupsDir } = pathsOf(folder);
    const db = connect(dbPath);
    createBackup(db, backupsDir, Date.now());
    db.exec('DROP TABLE scan_issues');
    closeCleanly(db);

    const { library } = harness(folder);
    expect(() => library.open()).not.toThrow();
    expect(library.status()).toMatchObject({ state: 'db-corrupt', backupAt: expect.any(Number) as number });

    expect(await library.restoreBackup()).toMatchObject({ ok: true, value: { state: 'ready', isEmpty: false } });
  });

  it('calls a read-only database file not writable, instead of failing at the first write', async () => {
    const folder = copyOfBaseLibrary('music');
    await libraryWithData(folder);
    const { dbPath } = pathsOf(folder);
    chmodSync(dbPath, 0o444);
    try {
      const { library } = harness(folder);
      library.open();
      expect(library.status()).toEqual({
        state: 'not-writable',
        folder,
        message: expect.stringContaining('read-only') as string,
      });
    } finally {
      chmodSync(dbPath, 0o666);
    }
  });

  describe('that has gone from beside its backups', () => {
    async function lostDatabase(folder: string, lose: (dbPath: string) => void) {
      await libraryWithData(folder);
      const { dbPath, backupsDir } = pathsOf(folder);
      const db = connect(dbPath);
      createBackup(db, backupsDir, Date.now());
      closeCleanly(db);
      lose(dbPath);
    }

    it.each([
      ['emptied', (dbPath: string) => writeFileSync(dbPath, '')],
      ['deleted', (dbPath: string) => rmSync(dbPath)],
    ])('%s: offers the backup instead of starting a new library', async (_name, lose) => {
      const folder = copyOfBaseLibrary('music');
      await lostDatabase(folder, lose);

      const { library, scanStates } = harness(folder);
      library.open();

      expect(library.status()).toMatchObject({
        state: 'db-corrupt',
        cause: 'lost',
        backupAt: expect.any(Number) as number,
      });
      expect(scanStates).toEqual([]);

      expect(await library.restoreBackup()).toMatchObject({ ok: true, value: { state: 'ready', isEmpty: false } });
      const tracks = library.read((queries) => queries.tracks({ kind: 'all' }));
      expect(tracks.ok && tracks.value).toHaveLength(BASE_FILES_READABLE);
    });

    it('starts over only when asked to', async () => {
      const folder = copyOfBaseLibrary('music');
      await lostDatabase(folder, (dbPath) => writeFileSync(dbPath, ''));

      const h = harness(folder);
      h.library.open();
      expect(await h.library.rebuild()).toMatchObject({ ok: true, value: { state: 'ready', isEmpty: true } });
      expect((await scanned(h)).lastReport).toMatchObject({ added: BASE_FILES_READABLE });
    });

    it('with nothing usable to restore, there is still the way out', async () => {
      const folder = copyOfBaseLibrary('music');
      await lostDatabase(folder, (dbPath) => writeFileSync(dbPath, ''));
      const { backupsDir } = pathsOf(folder);
      for (const backup of listBackups(backupsDir)) damage(backup);

      const { library } = harness(folder);
      library.open();
      expect(library.status()).toMatchObject({ state: 'db-corrupt', cause: 'lost', backupAt: null });
      expect(await library.rebuild()).toMatchObject({ ok: true, value: { state: 'ready' } });
    });
  });

  it('calls a locked or unwritable database not writable, and not a crash', () => {
    const folder = tempDir('music');
    const { dbPath, dataDir } = pathsOf(folder);
    mkdirSync(dbPath, { recursive: true });
    expect(existsSync(dataDir)).toBe(true);

    const { library } = harness(folder);
    expect(() => library.open()).not.toThrow();
    expect(library.status()).toMatchObject({ state: 'not-writable', folder, message: expect.any(String) as string });
  });

  it('flips to corrupt when the check in the background finds damage', async () => {
    const folder = copyOfBaseLibrary('music');
    await libraryWithData(folder);
    const { dbPath } = pathsOf(folder);
    damage(dbPath);

    const { library, statuses } = harness(folder);
    library.open();
    await vi.waitFor(() => expect(library.status().state).toBe('db-corrupt'));
    expect(statuses.at(-1)?.state).toBe('db-corrupt');
    expect(isOpen(library)).toBe(false);
  });

  it('flips to corrupt from a read, in one place, and returns the error', async () => {
    const folder = copyOfBaseLibrary('music');
    await libraryWithData(folder);
    const { library, statuses } = harness(folder, {
      runMaintenance: () => ({ stop: () => Promise.resolve() }),
    });
    library.open();

    const corrupt = Object.assign(new Error('database disk image is malformed'), { code: 'SQLITE_CORRUPT' });
    const result = library.read(() => {
      throw corrupt;
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'db_corrupt' } });
    expect(library.status()).toMatchObject({ state: 'db-corrupt', folder });
    expect(statuses.filter(({ state }) => state === 'db-corrupt')).toHaveLength(1);

    expect(library.read((queries) => queries.artists())).toMatchObject({ ok: false, error: { code: 'db_corrupt' } });
  });

  it('counts SQLITE_NOTADB as corruption too', () => {
    const folder = tempDir('music');
    const { library } = harness(folder);
    library.open();
    const result = library.read(() => {
      throw Object.assign(new Error('file is not a database'), { code: 'SQLITE_NOTADB' });
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'db_corrupt' } });
    expect(library.status().state).toBe('db-corrupt');
  });

  it('re-evaluates when the disk goes away under it', () => {
    const folder = tempDir('music');
    const { library } = harness(folder);
    library.open();
    const result = library.read(() => {
      throw Object.assign(new Error('disk I/O error'), { code: 'SQLITE_IOERR_READ' });
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'library_folder_missing' } });
  });

  it('lets a bug through as a bug', () => {
    const folder = tempDir('music');
    const { library } = harness(folder);
    library.open();
    expect(() =>
      library.read(() => {
        throw new TypeError('a bug');
      }),
    ).toThrow('a bug');
  });

  it('calls a failed migration what it is, leaves the database as it was, and has a backup', () => {
    const folder = tempDir('music');
    const { dbPath, backupsDir, dataDir } = pathsOf(folder);
    mkdirSync(dataDir, { recursive: true });
    const made = openDatabase(dbPath, { backupsDir, now: 1, migrations: [MIGRATIONS[0]!] });
    if (made.kind !== 'open') throw new Error('Could not make the database');
    // The next migration creates this index, so running it now has to fail.
    made.db.exec('CREATE INDEX files_art ON files (id)');
    closeCleanly(made.db);

    const { library } = harness(folder);
    library.open();
    expect(library.status()).toMatchObject({
      state: 'db-corrupt',
      folder,
      cause: 'migration-failed',
      backupAt: expect.any(Number) as number,
      message: expect.stringContaining("couldn't be updated") as string,
    });

    const after = new Database(dbPath, { readonly: true });
    expect(after.pragma('user_version', { simple: true })).toBe(1);
    expect(after.prepare("SELECT 1 FROM sqlite_master WHERE name = 'albums_art'").get()).toBeUndefined();
    after.close();
    expect(listBackups(backupsDir)).toHaveLength(1);
  });
});

describe('restoring a backup', () => {
  async function corruptLibraryWithBackup(folder: string) {
    await libraryWithData(folder);
    const { dbPath, backupsDir } = pathsOf(folder);
    const db = connect(dbPath);
    createBackup(db, backupsDir, Date.now());
    db.close();
    damage(dbPath);
  }

  it('sets the bad file aside and comes back with the backup', async () => {
    const folder = copyOfBaseLibrary('music');
    await corruptLibraryWithBackup(folder);

    const { library } = harness(folder);
    library.open();
    await vi.waitFor(() =>
      expect(library.status()).toMatchObject({ state: 'db-corrupt', backupAt: expect.any(Number) as number }),
    );

    const result = await library.restoreBackup();
    expect(result).toMatchObject({ ok: true, value: { state: 'ready', isEmpty: false } });

    const tracks = library.read((queries) => queries.tracks({ kind: 'all' }));
    expect(tracks.ok && tracks.value).toHaveLength(BASE_FILES_READABLE);

    const names = readdirSync(pathsOf(folder).dataDir);
    expect(names.some((name) => /^library\.bad-.*\.db$/.test(name))).toBe(true);
  });

  it('forgets the last report, which was about the database it replaced', async () => {
    const folder = copyOfBaseLibrary('music');
    const h = harness(folder);
    h.library.open();
    expect((await scanned(h)).lastReport).toMatchObject({ added: BASE_FILES_READABLE });

    const { dbPath, backupsDir } = pathsOf(folder);
    const db = connect(dbPath);
    createBackup(db, backupsDir, Date.now());
    db.close();

    expect(await h.library.restoreBackup()).toMatchObject({ ok: true, value: { state: 'ready' } });
    expect(h.library.scanState().lastReport).toBeNull();
  });

  it('says so when there is no backup', async () => {
    const folder = tempDir('music');
    const { dbPath, dataDir } = pathsOf(folder);
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(dbPath, 'garbage '.repeat(1000));
    const { library } = harness(folder);
    library.open();

    expect(await library.restoreBackup()).toMatchObject({ ok: false, error: { code: 'no_backup' } });
    expect(readFileSync(dbPath, 'utf8')).toContain('garbage');
    expect(library.status().state).toBe('db-corrupt');
  });

  it('skips a damaged backup for an older good one', async () => {
    const folder = copyOfBaseLibrary('music');
    await corruptLibraryWithBackup(folder);
    const { backupsDir } = pathsOf(folder);
    const [good] = listBackups(backupsDir);
    const worse = join(backupsDir, 'library-9999-12-31.db');
    copyFileSync(good ?? '', worse);
    damage(worse);

    const { library } = harness(folder);
    library.open();
    await vi.waitFor(() => expect(library.status().state).toBe('db-corrupt'));
    expect(await library.restoreBackup()).toMatchObject({ ok: true, value: { state: 'ready' } });
  });

  it('brings an old backup up to date', async () => {
    const folder = copyOfBaseLibrary('music');
    await corruptLibraryWithBackup(folder);
    const { backupsDir } = pathsOf(folder);
    const [backup] = listBackups(backupsDir);
    const old = new Database(backup ?? '');
    old.pragma('user_version = 1');
    old.exec('DROP INDEX files_art; DROP INDEX albums_art; ALTER TABLE files DROP COLUMN art_source;');
    old.close();

    const { library } = harness(folder);
    library.open();
    await vi.waitFor(() => expect(library.status().state).toBe('db-corrupt'));
    expect(await library.restoreBackup()).toMatchObject({ ok: true, value: { state: 'ready' } });
    expect(sql(library, 'PRAGMA user_version')).toEqual({ user_version: LATEST });
  });

  it('asks for a folder first', async () => {
    const { library } = harness(null);
    library.open();
    expect(await library.restoreBackup()).toMatchObject({ ok: false, error: { code: 'no_library' } });
  });

  it('works from a too-new database too', async () => {
    const folder = copyOfBaseLibrary('music');
    await libraryWithData(folder);
    const { dbPath, backupsDir } = pathsOf(folder);
    const db = connect(dbPath);
    createBackup(db, backupsDir, Date.now());
    db.pragma(`user_version = ${LATEST + 1}`);
    closeCleanly(db);

    const { library } = harness(folder);
    library.open();
    expect(library.status().state).toBe('db-too-new');
    expect(await library.restoreBackup()).toMatchObject({ ok: true, value: { state: 'ready' } });
  });
});

describe('rebuilding', () => {
  it('sets the file aside, starts empty, and scans', async () => {
    const folder = copyOfBaseLibrary('music');
    const { dbPath, dataDir } = pathsOf(folder);
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(dbPath, 'garbage '.repeat(1000));

    const h = harness(folder);
    h.library.open();
    expect(h.library.status().state).toBe('db-corrupt');

    const result = await h.library.rebuild();
    expect(result).toMatchObject({ ok: true, value: { state: 'ready', isEmpty: true } });

    const finished = await scanned(h);
    expect(finished.lastReport).toMatchObject({ added: BASE_FILES_READABLE });
    expect(h.library.status()).toMatchObject({ state: 'ready', isEmpty: false });

    const names = readdirSync(dataDir);
    const aside = names.find((name) => /^library\.bad-.*\.db$/.test(name)) ?? '';
    expect(readFileSync(join(dataDir, aside), 'utf8')).toContain('garbage');
  });

  it('forgets the last report while the new scan runs, since it was about the database set aside', async () => {
    const h = harness(copyOfBaseLibrary('music'));
    h.library.open();
    expect((await scanned(h)).lastReport).toMatchObject({ added: BASE_FILES_READABLE });

    expect(await h.library.rebuild()).toMatchObject({ ok: true, value: { state: 'ready' } });
    expect(h.library.scanState().lastReport).toBeNull();
  });

  it('asks for a folder first', async () => {
    const { library } = harness(null);
    library.open();
    expect(await library.rebuild()).toMatchObject({ ok: false, error: { code: 'no_library' } });
  });
});

describe('choosing a folder', () => {
  it('returns the status unchanged when cancelled', async () => {
    const { library, folder } = harness(null);
    library.open();
    expect(await library.chooseFolder()).toEqual({ state: 'no-folder' });
    expect(folder.current).toBeNull();
  });

  it('remembers the folder, opens it, and scans a library with no files yet', async () => {
    const music = copyOfBaseLibrary('music');
    const h = harness(null);
    h.library.open();
    h.picks.push(music);

    const status = await h.library.chooseFolder();
    expect(status).toMatchObject({ state: 'ready', folder: resolve(music), isEmpty: true });
    expect(h.folder.current).toBe(resolve(music));
    expect(h.library.scanState().phase).not.toBe('idle');

    const finished = await scanned(h);
    expect(finished.lastReport).toMatchObject({ added: BASE_FILES_READABLE });
  });

  it('does not rescan a library that already has files', async () => {
    const music = copyOfBaseLibrary('music');
    await libraryWithData(music);
    const h = harness(null);
    h.library.open();
    h.picks.push(music);
    await h.library.chooseFolder();
    expect(h.library.scanState().phase).toBe('idle');
    expect(h.library.status()).toMatchObject({ state: 'ready', isEmpty: false });
  });

  it('cancels a running scan before switching', async () => {
    const first = copyOfBaseLibrary('music-one');
    const second = copyOfBaseLibrary('music-two');
    const h = harness(first);
    h.library.open();
    h.library.startScan();
    expect(h.library.scanState().phase).not.toBe('idle');

    h.picks.push(second);
    const status = await h.library.chooseFolder();
    expect(status).toMatchObject({ state: 'ready', folder: resolve(second) });
    await scanned(h);

    const tracks = h.library.read((queries) => queries.tracks({ kind: 'all' }));
    expect(tracks.ok && tracks.value).toHaveLength(BASE_FILES_READABLE);
    const firstDb = connect(pathsOf(first).dbPath);
    expect(firstDb.prepare("SELECT value FROM library_meta WHERE key = 'last_scan_at'").get()).toBeUndefined();
    firstDb.close();
  });

  it('does nothing when the same folder is picked again', async () => {
    const music = copyOfBaseLibrary('music');
    await libraryWithData(music);
    const h = harness(music);
    h.library.open();
    const connection = h.library.perConnection((db) => db);
    const before = connection((db) => db);
    h.picks.push(music);
    await h.library.chooseFolder();
    expect(connection((db) => db)).toEqual(before);
    expect(before.ok && before.value.open).toBe(true);
  });

  it('forgets the last report with the library it was about', async () => {
    const one = copyOfBaseLibrary('music-one');
    const two = copyOfBaseLibrary('music-two');
    const h = harness(one);
    h.library.open();
    expect((await scanned(h)).lastReport).toMatchObject({ added: BASE_FILES_READABLE });

    h.picks.push(two);
    await h.library.chooseFolder();
    await scanned(h);
    expect(h.library.scanState().lastReport).toMatchObject({ added: BASE_FILES_READABLE });

    h.picks.push(one);
    await h.library.chooseFolder();
    expect(h.library.scanState().phase).toBe('idle');
    expect(h.library.scanState().lastReport).toBeNull();
  });

  it('a check still running on the library it left says nothing about the one now open', async () => {
    const one = copyOfBaseLibrary('music-one');
    const two = copyOfBaseLibrary('music-two');
    await libraryWithData(one);
    await libraryWithData(two);

    const { run, stop, events, release } = heldMaintenance();
    const h = harness(one, { runMaintenance: run });
    h.library.open();
    h.picks.push(two);
    const switching = h.library.chooseFolder();
    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
    release();
    await switching;

    events[0]?.({ type: 'check', problem: 'row 3 missing from index' });
    expect(h.library.status()).toMatchObject({ state: 'ready', folder: resolve(two) });
  });

  it('finishes with one operation before starting the next', async () => {
    const one = copyOfBaseLibrary('music-one');
    const two = tempDir('music-two');
    await libraryWithData(one);

    const { run, stop, release } = heldMaintenance();
    const h = harness(one, { runMaintenance: run });
    h.library.open();
    h.picks.push(two);

    const switching = h.library.chooseFolder();
    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
    const rebuilding = h.library.rebuild();
    await new Promise((done) => setTimeout(done, 50));

    expect(h.folder.current).toBe(one);
    expect(run).toHaveBeenCalledOnce();
    expect(readdirSync(pathsOf(one).dataDir).some((name) => name.includes('.bad-'))).toBe(false);

    release();
    await switching;
    await rebuilding;
    expect(h.folder.current).toBe(resolve(two));
  });

  it('keeps two folders in two databases', async () => {
    const one = copyOfBaseLibrary('music-one');
    const two = tempDir('music-two');
    const h = harness(one);
    h.library.open();
    h.library.startScan();
    await scanned(h);

    h.picks.push(two);
    expect(await h.library.chooseFolder()).toMatchObject({ state: 'ready', folder: resolve(two), isEmpty: true });
    await scanned(h);

    h.picks.push(one);
    expect(await h.library.chooseFolder()).toMatchObject({ state: 'ready', folder: resolve(one), isEmpty: false });
  });

  it('survives two windows asking at once, and only opens one dialog', async () => {
    const music = tempDir('music');
    const pickFolder = vi.fn(() => Promise.resolve<string | null>(music));
    const h = harness(null, { pickFolder });
    h.library.open();
    const [one, other] = await Promise.all([h.library.chooseFolder(), h.library.chooseFolder()]);
    expect([one.state, other.state].toSorted()).toEqual(['no-folder', 'ready']);
    expect(pickFolder).toHaveBeenCalledOnce();
    await scanned(h);
  });

  it('says a new folder is being scanned before it says it is ready, so it never looks empty', async () => {
    const h = harness(null);
    h.library.open();
    h.picks.push(copyOfBaseLibrary('music'));
    await h.library.chooseFolder();
    const walking = h.order.indexOf('walking');
    expect(walking).toBeGreaterThanOrEqual(0);
    expect(walking).toBeLessThan(h.order.indexOf('ready'));
    await scanned(h);
  });

  it('survives everything being asked at once', async () => {
    const music = copyOfBaseLibrary('music');
    const h = harness(music);
    h.library.open();
    h.library.startScan();
    const results = await Promise.all([
      h.library.retryOpen(),
      h.library.retryOpen(),
      h.library.rebuild(),
      h.library.restoreBackup(),
      h.library.retryOpen(),
    ]);
    expect(results).toHaveLength(5);
    await scanned(h);
    expect(h.library.status().state).toBe('ready');
  });
});

describe('a first scan that never finished', () => {
  it('carries on when the library opens, because a library that is half there looks finished', async () => {
    const music = copyOfBaseLibrary('music');
    const interrupted = heldScan();
    const first = harness(music, { runScan: interrupted.run });
    first.library.open();
    expect(first.library.scanState().phase).toBe('walking');
    interrupted.finish();
    await first.library.close();

    const h = harness(music);
    h.library.open();
    expect(h.library.scanState().phase).toBe('walking');
    expect((await scanned(h)).lastReport).toMatchObject({ added: BASE_FILES_READABLE });
  });

  it('does not scan by itself once one has finished', async () => {
    const music = copyOfBaseLibrary('music');
    await libraryWithData(music);
    const h = harness(music);
    h.library.open();
    expect(h.library.scanState().phase).toBe('idle');
    expect(h.scanStates).toEqual([]);
  });

  it('does not scan by itself when one finished on an empty folder either', async () => {
    const music = tempDir('music');
    await libraryWithData(music);
    const h = harness(music);
    h.library.open();
    expect(h.scanStates).toEqual([]);
  });
});

describe('what later modules build on', () => {
  it("prepares a module's statements once per connection, and again for the next one", async () => {
    const one = copyOfBaseLibrary('music-one');
    const two = copyOfBaseLibrary('music-two');
    await libraryWithData(one);
    await libraryWithData(two);
    const h = harness(one);
    h.library.open();

    const create = vi.fn((db: Connection) => db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM files'));
    const count = h.library.perConnection(create);
    expect(count((statement) => statement.get())).toEqual({ ok: true, value: { n: BASE_FILES_READABLE } });
    count((statement) => statement.get());
    expect(create).toHaveBeenCalledOnce();

    h.picks.push(two);
    await h.library.chooseFolder();
    expect(count((statement) => statement.get())).toMatchObject({ ok: true });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('guards them the way it guards reads', () => {
    const none = harness(null);
    none.library.open();
    const unused = vi.fn();
    expect(none.library.perConnection(unused)(() => 1)).toMatchObject({ ok: false, error: { code: 'no_library' } });
    expect(unused).not.toHaveBeenCalled();

    const { library } = harness(tempDir('music'));
    library.open();
    const queries = library.perConnection(() => 'prepared');
    const result = queries(() => {
      throw Object.assign(new Error('malformed'), { code: 'SQLITE_CORRUPT_VTAB' });
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'db_corrupt' } });
    expect(library.status().state).toBe('db-corrupt');
  });
});

describe('scanning through the library', () => {
  it('refuses a second scan while one runs', async () => {
    const h = harness(copyOfBaseLibrary('music'));
    h.library.open();
    expect(h.library.startScan()).toMatchObject({ ok: false, error: { code: 'scan_running' } });
    await scanned(h);
    expect(h.library.startScan().ok).toBe(true);
    await scanned(h);
  });

  it('refuses a scan with no library', () => {
    const { library } = harness(null);
    library.open();
    expect(library.startScan()).toMatchObject({ ok: false, error: { code: 'no_library' } });
  });

  it('goes through its phases, ends idle, and keeps the report', async () => {
    const h = harness(copyOfBaseLibrary('music'));
    h.library.open();
    h.library.startScan();
    const finished = await scanned(h);

    const phases = h.scanStates.map(({ phase }) => phase).filter((phase, index, all) => phase !== all[index - 1]);
    expect(phases).toEqual(['walking', 'reading', 'hashing', 'writing', 'art', 'idle']);
    expect(finished).toMatchObject({ phase: 'idle', currentPath: null, lastReport: { added: BASE_FILES_READABLE } });
    expect(h.library.scanState().lastReport?.added).toBe(BASE_FILES_READABLE);
  });

  it('fills the art cache in its last phase', async () => {
    const h = harness(copyOfBaseLibrary('music'));
    h.library.open();
    h.library.startScan();
    await scanned(h);
    expect(h.artWorkers()).toBe(1);
    expect(readdirSync(cacheDir).length).toBeGreaterThan(0);
    const colored = sql(h.library, 'SELECT COUNT(*) AS n FROM art WHERE color IS NOT NULL');
    expect(colored).toEqual({ n: 3 });
  });

  it('removes cache files whose art row went away, at the end of a full scan', async () => {
    const music = copyOfBaseLibrary('music');
    const h = harness(music);
    h.library.open();
    h.library.startScan();
    await scanned(h);
    const before = readdirSync(cacheDir).length;

    rmSync(join(music, 'Artist One', 'Album A'), { recursive: true });
    await vi.waitFor(() => expect(h.library.startScan().ok).toBe(true));
    await scanned(h);

    const removed = sql(h.library, 'SELECT COUNT(*) AS n FROM art');
    expect(removed).toEqual({ n: 3 });
    expect(readdirSync(cacheDir).length).toBe(before);
  });

  it('summarizes the scan in a notice, pointing at storage when there were issues', async () => {
    const h = harness(copyOfBaseLibrary('music'));
    h.library.open();
    h.library.startScan();
    await scanned(h);
    await vi.waitFor(() => expect(h.notices).toHaveLength(1));
    expect(h.notices[0]).toMatchObject({
      level: 'info',
      message: `Scan finished: ${BASE_FILES_READABLE} added, 3 with issues`,
      action: { kind: 'open-storage' },
    });
  });

  it('says the library is up to date when nothing changed', async () => {
    const music = copyOfBaseLibrary('music');
    await libraryWithData(music);
    rmSync(join(music, 'Broken'), { recursive: true });
    rmSync(join(music, 'No Tags'), { recursive: true });
    const h = harness(music);
    h.library.open();
    h.library.startScan();
    await scanned(h);
    h.library.startScan();
    await scanned(h);
    await vi.waitFor(() => expect(h.notices).toHaveLength(2));
    expect(h.notices[1]).toMatchObject({ message: 'Library is up to date', action: null });
  });

  it('leaves it to the screen to say a folder has nothing in it', async () => {
    const h = harness(tempDir('music'));
    h.library.open();
    await scanned(h);
    expect(h.library.status()).toMatchObject({ state: 'ready', isEmpty: true });
    expect(h.notices).toEqual([]);
  });

  it('leaves the art to the scan when one starts before its turn comes', async () => {
    const music = copyOfBaseLibrary('music');
    await libraryWithData(music);
    const log = { warn: vi.fn(), error: vi.fn() };
    const cache = createArtCache({ cacheDir, ffmpegPath: FFMPEG, start: artInProcess().start, log });
    const pass = vi.spyOn(cache, 'runBackgroundPass');
    const scan = heldScan();

    const { library } = harness(music, { art: cache, artPassDelayMs: 5, runScan: scan.run });
    library.open();
    library.startScan();
    await new Promise((done) => setTimeout(done, 50));

    expect(pass).not.toHaveBeenCalled();
    scan.finish();
  });

  it('emits library.changed during and at the end', async () => {
    const h = harness(copyOfBaseLibrary('music'));
    h.library.open();
    h.library.startScan();
    await scanned(h);
    expect(h.changed.length).toBeGreaterThanOrEqual(1);
    expect(h.changed.at(-1)).toEqual(['library']);
  });

  it('updates the status as the first files arrive', async () => {
    const h = harness(copyOfBaseLibrary('music'));
    h.library.open();
    expect(h.library.status()).toMatchObject({ isEmpty: true });
    h.library.startScan();
    await scanned(h);
    expect(h.statuses.at(-1)).toMatchObject({ state: 'ready', isEmpty: false, lastChanged: { host: 'this-machine' } });
  });

  it('warns when the folder looks empty, instead of marking everything missing', async () => {
    const music = copyOfBaseLibrary('music');
    await libraryWithData(music);
    for (const name of readdirSync(music)) rmSync(join(music, name), { recursive: true });

    const h = harness(music);
    h.library.open();
    h.library.startScan();
    await scanned(h);
    await vi.waitFor(() => expect(h.notices).toHaveLength(1));
    expect(h.notices[0]).toMatchObject({ level: 'warning', message: expect.stringContaining('looks empty') as string });
    expect(h.library.read((queries) => queries.counts())).toMatchObject({ value: { missing: 0 } });
  });

  it('re-evaluates the status when the folder cannot be read, and the screen that brings is the whole answer', async () => {
    const parent = tempDir('music');
    const music = join(parent, 'library');
    mkdirSync(music);
    await libraryWithData(music);
    const h = harness(music);
    h.library.open();
    renameSync(music, join(parent, 'gone'));
    h.library.startScan();
    await vi.waitFor(() => expect(h.library.status()).toEqual({ state: 'folder-missing', folder: music }));
    await new Promise((done) => setTimeout(done, 20));
    expect(h.notices).toEqual([]);
  });

  it('can be cancelled during the art phase, which ends the scan with its report', async () => {
    const h = harness(copyOfBaseLibrary('music'));
    h.library.open();
    h.library.startScan();
    await vi.waitFor(() => expect(h.library.scanState().phase).toBe('art'), { timeout: 30_000, interval: 1 });
    h.library.cancelScan();
    const finished = await scanned(h);
    expect(finished.lastReport).toMatchObject({ cancelled: false, added: BASE_FILES_READABLE });
    await vi.waitFor(() => expect(h.notices).toHaveLength(1));
  });

  it('announces colors as they arrive, without flooding', async () => {
    const h = harness(copyOfBaseLibrary('music'));
    h.library.open();
    h.library.startScan();
    await scanned(h);
    const before = h.changed.length;
    await vi.waitFor(() => expect(h.changed.length).toBeGreaterThan(before), { timeout: 5_000 });
    expect(h.changed.length).toBeLessThanOrEqual(before + 2);
  });

  it('can be cancelled, keeping nothing marked missing', async () => {
    const music = copyOfBaseLibrary('music');
    const h = harness(music);
    h.library.open();
    h.library.startScan();
    h.library.cancelScan();
    const finished = await scanned(h);
    expect(finished.lastReport).toMatchObject({ cancelled: true, nowMissing: 0 });
    await vi.waitFor(() => expect(h.notices).toHaveLength(1));
    expect(h.notices[0]?.message).toContain('cancelled');
  });

  it('turns a crashed scan into a notice, and is ready for another', async () => {
    const crashing: ScanRunner = (_job, onEvent) => {
      queueMicrotask(() => onEvent({ type: 'failed', message: 'it broke', code: null }));
      return { cancel: () => {}, terminate: () => Promise.resolve() };
    };
    const h = harness(tempDir('music'), { runScan: crashing });
    h.library.open();
    h.library.startScan();
    await scanned(h);
    expect(h.notices[0]).toMatchObject({ level: 'error' });
    expect(h.library.startScan().ok).toBe(true);
  });

  it('turns a corrupt database found by the scan into the status', async () => {
    const corrupting: ScanRunner = (_job, onEvent) => {
      queueMicrotask(() => onEvent({ type: 'failed', message: 'malformed', code: 'SQLITE_CORRUPT' }));
      return { cancel: () => {}, terminate: () => Promise.resolve() };
    };
    const h = harness(tempDir('music'), { runScan: corrupting });
    h.library.open();
    h.library.startScan();
    await vi.waitFor(() => expect(h.library.status().state).toBe('db-corrupt'));
  });

  it('forces the end of a scan that will not stop', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const terminate = vi.fn(() => Promise.resolve());
      const stuck: ScanRunner = () => ({ cancel: () => {}, terminate });
      const h = harness(tempDir('music'), { runScan: stuck });
      h.library.open();
      h.library.startScan();
      const closing = h.library.close();
      await vi.advanceTimersByTimeAsync(6_000);
      await closing;
      expect(terminate).toHaveBeenCalled();
      expect(isOpen(h.library)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('what later phases use', () => {
  async function ready() {
    const music = copyOfBaseLibrary('music');
    const h = harness(music);
    h.library.open();
    h.library.startScan();
    await scanned(h);
    const tracks = h.library.read((queries) => queries.tracks({ kind: 'all' }));
    if (!tracks.ok) throw new Error('No tracks');
    return { ...h, music, tracks: tracks.value };
  }

  it('hands out tracks by id, in the given order', async () => {
    const { library, tracks } = await ready();
    const ids = tracks.map(({ id }) => id).toReversed();
    const result = library.tracksByIds(ids);
    expect(result.ok && result.value.map(({ id }) => id)).toEqual(ids);
  });

  it('works out the absolute path of a track', async () => {
    const { library, tracks, music } = await ready();
    const track = tracks.find(({ title }) => title === 'First');
    expect(library.absolutePath(track?.id ?? 0)).toBe(join(music, 'Artist One', 'Album A', '01 First.flac'));
    expect(library.absolutePath(99999)).toBeNull();
  });

  it('has no paths or tracks with no library', () => {
    const { library } = harness(null);
    library.open();
    expect(library.absolutePath(1)).toBeNull();
    expect(library.tracksByIds([1])).toMatchObject({ ok: false, error: { code: 'no_library' } });
    expect(isOpen(library)).toBe(false);
  });

  it('marks a file missing, and a scan brings it back', async () => {
    const { library, tracks, changed } = await ready();
    const id = tracks[0]?.id ?? 0;
    const changes = changed.length;

    library.markMissing(id);
    expect(library.tracksByIds([id])).toMatchObject({ value: [{ isMissing: true }] });
    expect(changed.length).toBe(changes + 1);

    library.markMissing(id);
    expect(changed.length).toBe(changes + 1);

    library.startScan();
    await vi.waitFor(() => expect(library.scanState().phase).toBe('idle'), { timeout: 30_000 });
    expect(library.tracksByIds([id])).toMatchObject({ value: [{ isMissing: false }] });
  });

  it('removes missing files on request, telling every list', async () => {
    const { library, tracks, music, changed } = await ready();
    const victim = tracks.find(({ title }) => title === 'First');
    rmSync(join(music, 'Artist One', 'Album A', '01 First.flac'));
    library.startScan();
    await vi.waitFor(() => expect(library.scanState().phase).toBe('idle'), { timeout: 30_000 });

    expect(library.removeMissing()).toEqual({ ok: true, value: { removed: 1 } });
    expect(changed.at(-1)).toEqual(['library', 'playlists', 'stats', 'lyrics']);
    expect(library.tracksByIds([victim?.id ?? 0])).toEqual({ ok: true, value: [] });
    expect(library.status()).toMatchObject({ state: 'ready', lastChanged: { host: 'this-machine' } });
  });

  it('refuses to remove anything during a scan', async () => {
    const { library } = await ready();
    library.startScan();
    expect(library.removeMissing()).toMatchObject({ ok: false, error: { code: 'scan_running' } });
    await vi.waitFor(() => expect(library.scanState().phase).toBe('idle'), { timeout: 30_000 });
  });

  it('reports what is stored', async () => {
    const { library, music } = await ready();
    expect(library.storedInfo()).toMatchObject({
      libraryFolder: music,
      databasePath: pathsOf(music).dbPath,
      databaseBytes: expect.any(Number) as number,
      counts: { tracks: BASE_FILES_READABLE, missing: 0 },
      lastScanAt: expect.any(Number) as number,
      lastChanged: { host: 'this-machine' },
    });
  });

  it('reports what it can with no library', () => {
    const { library } = harness(null);
    library.open();
    expect(library.storedInfo()).toEqual({
      libraryFolder: null,
      databasePath: null,
      databaseBytes: null,
      counts: { tracks: 0, albums: 0, artists: 0, missing: 0 },
      lastScanAt: null,
      lastChanged: null,
    });
  });
});

describe('art through the library', () => {
  it('serves a thumbnail for a hash it knows', async () => {
    const music = copyOfBaseLibrary('music');
    const art = artInProcess();
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const cache = createArtCache({ cacheDir, ffmpegPath: FFMPEG, start: art.start, log });
    const h = harness(music, { art: cache });
    h.library.open();
    h.library.startScan();
    await scanned(h);

    const tracks = h.library.read((queries) => queries.tracks({ kind: 'all' }));
    const hash = (tracks.ok ? tracks.value : []).find(({ title }) => title === 'First')?.artHash ?? '';
    expect(await cache.resolve(hash, 'thumb')).toMatchObject({ mime: 'image/jpeg' });
    expect(await cache.resolve(hash, 'full')).toMatchObject({ mime: 'image/png' });
    expect(await cache.resolve('0123456789abcdef', 'thumb')).toBeNull();
    await cache.stop();
  });

  it('runs the background pass after opening a library missing its cache', async () => {
    const music = copyOfBaseLibrary('music');
    await libraryWithData(music);
    rmSync(cacheDir, { recursive: true });
    mkdirSync(cacheDir);

    const h = harness(music, { artPassDelayMs: 0 });
    h.library.open();
    await vi.waitFor(() => expect(readdirSync(cacheDir).length).toBeGreaterThan(0), { timeout: 20_000 });
    await vi.waitFor(() => expect(h.artWorkers()).toBe(1));
  });

  describe('on a machine with an empty cache', () => {
    async function withEmptyCache(music: string) {
      rmSync(cacheDir, { recursive: true });
      mkdirSync(cacheDir);
      const log = { warn: vi.fn(), error: vi.fn() };
      const cache = createArtCache({ cacheDir, ffmpegPath: FFMPEG, start: artInProcess().start, log });
      const h = harness(music, { art: cache });
      h.library.open();
      await scanned(h);
      return { ...h, cache };
    }

    const FOLDER_ART_TRACK = 'Artist One/Album B/CD1/01 Disc One.flac';
    const hashOf = (library: Library, relPath: string) => {
      const tracks = library.read((queries) => queries.tracks({ kind: 'all' }));
      return (tracks.ok ? tracks.value : []).find((track) => track.relPath === relPath)?.artHash ?? '';
    };

    it('rebuilds folder art from where the folder is now', async () => {
      const music = copyOfBaseLibrary('music');
      await libraryWithData(music);
      renameSync(join(music, 'Artist One', 'Album B'), join(music, 'Artist One', 'Renamed'));
      const first = harness(music);
      first.library.open();
      first.library.startScan();
      await scanned(first);
      await first.library.close();

      const { library, cache } = await withEmptyCache(music);
      const hash = hashOf(library, 'Artist One/Renamed/CD1/01 Disc One.flac');
      expect(await cache.resolve(hash, 'full')).not.toBeNull();
      await cache.stop();
    });

    it('finds a folder image through another folder using it, when no scan has noticed the first has gone', async () => {
      const music = copyOfBaseLibrary('music');
      cpSync(join(music, 'Artist One', 'Album B', 'folder.jpg'), join(music, 'The Beatles', 'folder.jpg'));
      await libraryWithData(music);
      const opened = harness(music);
      opened.library.open();
      const hash = hashOf(opened.library, FOLDER_ART_TRACK);
      const row = opened.library.read((queries) => queries.artRow(hash));
      await opened.library.close();
      rmSync(toAbsolute(music, row.ok ? (row.value?.sourceRelPath ?? '') : ''));

      const { cache } = await withEmptyCache(music);
      expect(await cache.resolve(hash, 'full')).not.toBeNull();
      await cache.stop();
    });
  });

  it('starts no art worker just for opening a library whose cache is complete', async () => {
    const music = copyOfBaseLibrary('music');
    await libraryWithData(music);

    const h = harness(music, { artPassDelayMs: 0 });
    h.library.open();
    await new Promise((done) => setTimeout(done, 300));
    expect(h.artWorkers()).toBe(0);
  });
});

describe('closing', () => {
  it('waits for maintenance to stop before it closes the connection', async () => {
    const music = copyOfBaseLibrary('music');
    await libraryWithData(music);
    const { run, stop, release } = heldMaintenance();
    const { library } = harness(music, { runMaintenance: run });
    library.open();
    const { dbPath } = pathsOf(music);

    const closing = library.close();
    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
    await new Promise((done) => setTimeout(done, 20));
    expect(existsSync(`${dbPath}-wal`)).toBe(true);

    release();
    await closing;
    expect(existsSync(`${dbPath}-wal`)).toBe(false);
  });

  it('leaves the .db complete, with no WAL', async () => {
    const music = copyOfBaseLibrary('music');
    const h = harness(music);
    h.library.open();
    h.library.startScan();
    await scanned(h);
    await h.library.close();

    const { dbPath } = pathsOf(music);
    expect(existsSync(`${dbPath}-wal`)).toBe(false);
    const copy = new Database(dbPath, { readonly: true });
    expect(copy.prepare('SELECT COUNT(*) AS n FROM tracks').get()).toEqual({ n: BASE_FILES_READABLE });
    copy.close();
  });

  it('stops a running scan first', async () => {
    const music = copyOfBaseLibrary('music');
    const h = harness(music);
    h.library.open();
    h.library.startScan();
    await h.library.close();
    expect(h.library.scanState().phase).toBe('idle');
    expect(isOpen(h.library)).toBe(false);
  });

  it('is safe to do twice', async () => {
    const { library } = harness(tempDir('music'));
    library.open();
    await library.close();
    await library.close();
  });
});
