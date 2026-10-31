import { chmodSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createBackup } from '@main/db/backups';
import { APPLICATION_ID, BUSY_TIMEOUT_MS, type Connection } from '@main/db/connection';
import type { Migration } from '@main/db/migrations';
import { MIGRATIONS } from '@main/db/migrations';
import { closeCleanly, openDatabase } from '@main/db/open';
import { tempDir } from '@main/library/testFixtures';

const LATEST = MIGRATIONS.at(-1)?.version ?? 0;

let dir: string;
let dbPath: string;
let backupsDir: string;

function open(migrations?: Migration[]) {
  return openDatabase(dbPath, { backupsDir, now: 1_000_000_000_000, ...(migrations ? { migrations } : {}) });
}

function expectOpen(outcome: ReturnType<typeof openDatabase>): Connection {
  if (outcome.kind !== 'open') throw new Error(`Expected it to open, got ${outcome.kind}`);
  return outcome.db;
}

function opened(migrations?: Migration[]): Connection {
  return expectOpen(open(migrations));
}

function backups(): string[] {
  return existsSync(backupsDir) ? readdirSync(backupsDir) : [];
}

const tables = (db: Connection) =>
  db
    .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map(({ name }) => name);

beforeEach(() => {
  dir = tempDir('open');
  dbPath = join(dir, 'library.db');
  backupsDir = join(dir, 'backups');
});

describe('migration 7', () => {
  it('drops waveforms with no RMS, so they get worked out again, and leaves the rest', () => {
    const before = MIGRATIONS.filter(({ version }) => version < 7);
    const old = opened(before);
    old.exec(`
      INSERT INTO files (id, rel_path, size_bytes, mtime_ms, codec, duration_ms, scanned_at)
        VALUES (1, 'a.flac', 1, 1, 'FLAC', 1000, 1);
      INSERT INTO waveforms (file_id, peaks, generated_at) VALUES (1, x'01', 2);
    `);
    closeCleanly(old);

    const db = opened();
    expect(db.prepare('SELECT count(*) AS n FROM waveforms').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM files').get()).toEqual({ n: 1 });
    db.prepare("INSERT INTO waveforms (file_id, peaks, rms, generated_at) VALUES (1, x'01', x'01', 2)").run();
    closeCleanly(db);
  });
});

describe('openDatabase', () => {
  it('creates a new database, set up and migrated, with no backup', () => {
    const db = opened();
    expect(db.pragma('application_id', { simple: true })).toBe(APPLICATION_ID);
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('busy_timeout', { simple: true })).toBeGreaterThan(0);
    expect(tables(db)).toEqual(expect.arrayContaining(['files', 'tracks', 'artists', 'albums', 'tracks_fts']));
    closeCleanly(db);
    expect(backups()).toEqual([]);
  });

  it('opens an existing database as it is, with no backup', () => {
    const first = opened();
    first.prepare("INSERT INTO library_meta (key, value) VALUES ('kept', 'yes')").run();
    closeCleanly(first);

    const again = opened();
    expect(again.prepare("SELECT value FROM library_meta WHERE key = 'kept'").get()).toEqual({ value: 'yes' });
    closeCleanly(again);
    expect(backups()).toEqual([]);
  });

  it('treats an empty file as new', () => {
    writeFileSync(dbPath, '');
    const db = opened();
    expect(db.pragma('application_id', { simple: true })).toBe(APPLICATION_ID);
    closeCleanly(db);
  });

  describe('with backups beside it', () => {
    beforeEach(() => {
      const db = opened();
      db.prepare("INSERT INTO library_meta (key, value) VALUES ('kept', 'yes')").run();
      createBackup(db, backupsDir, 1_000_000_000_000);
      closeCleanly(db);
    });

    it('an empty file is a lost database, not a new one', () => {
      writeFileSync(dbPath, '');
      expect(open()).toMatchObject({ kind: 'corrupt', cause: 'lost' });
      expect(statSync(dbPath).size).toBe(0);
    });

    it('so is one that is gone, and it is not created', () => {
      rmSync(dbPath);
      expect(open()).toMatchObject({ kind: 'corrupt', cause: 'lost' });
      expect(existsSync(dbPath)).toBe(false);
    });

    it('starts empty when that is what was asked for', () => {
      rmSync(dbPath);
      const db = expectOpen(openDatabase(dbPath, { backupsDir, now: 1, startFresh: true }));
      expect(db.prepare("SELECT 1 FROM library_meta WHERE key = 'kept'").get()).toBeUndefined();
      closeCleanly(db);
    });
  });

  describe('a database that can be opened but not written', () => {
    it('says so straight away when the file is read-only', () => {
      closeCleanly(opened());
      chmodSync(dbPath, 0o444);
      try {
        expect(open()).toMatchObject({ kind: 'unwritable', message: expect.stringContaining('read-only') as string });
      } finally {
        chmodSync(dbPath, 0o666);
      }
    });

    it('says so at once when another connection holds it, instead of waiting on the main thread', () => {
      closeCleanly(opened());
      const holder = new Database(dbPath);
      holder.pragma('locking_mode = EXCLUSIVE');
      holder.exec('BEGIN EXCLUSIVE');
      try {
        const started = performance.now();
        const outcome = open();
        expect(outcome).toMatchObject({ kind: 'unwritable' });
        expect(performance.now() - started).toBeLessThan(2_000);
      } finally {
        holder.exec('COMMIT');
        holder.close();
      }

      const db = opened();
      expect(db.pragma('busy_timeout', { simple: true })).toBe(BUSY_TIMEOUT_MS);
      closeCleanly(db);
    });
  });

  describe('a file that is not this app database', () => {
    it('calls a SQLite file with another application id corrupt, and leaves it alone', () => {
      const other = new Database(dbPath);
      other.exec('CREATE TABLE theirs (a); INSERT INTO theirs VALUES (1)');
      other.close();
      const before = readFileSync(dbPath);
      const { mtimeMs } = statSync(dbPath);

      expect(open()).toMatchObject({ kind: 'corrupt', cause: 'not-ours' });
      expect(readFileSync(dbPath)).toEqual(before);
      expect(statSync(dbPath).mtimeMs).toBe(mtimeMs);
    });

    it('calls garbage corrupt, and leaves it alone', () => {
      writeFileSync(dbPath, 'this is not a database, however long it goes on '.repeat(100));
      const before = readFileSync(dbPath);
      expect(open()).toMatchObject({ kind: 'corrupt', cause: 'damaged' });
      expect(readFileSync(dbPath)).toEqual(before);
    });
  });

  describe('a database from a newer version', () => {
    function makeTooNew() {
      const db = opened();
      db.prepare("INSERT INTO library_meta (key, value) VALUES ('newer', 'data')").run();
      db.pragma(`user_version = ${LATEST + 5}`);
      closeCleanly(db);
    }

    it('is refused, and not touched', () => {
      makeTooNew();
      const before = readFileSync(dbPath);
      const { mtimeMs } = statSync(dbPath);

      expect(open()).toEqual({ kind: 'too-new' });

      expect(readFileSync(dbPath)).toEqual(before);
      expect(statSync(dbPath).mtimeMs).toBe(mtimeMs);
      expect(existsSync(`${dbPath}-wal`)).toBe(false);
      expect(backups()).toEqual([]);
    });
  });

  describe('migrations', () => {
    const one: Migration = { version: 1, name: 'one', sql: 'CREATE TABLE one (a); INSERT INTO one VALUES (1);' };
    const two: Migration = { version: 2, name: 'two', sql: 'CREATE TABLE two (b); ALTER TABLE one ADD COLUMN c;' };
    const broken: Migration = {
      version: 3,
      name: 'broken',
      sql: 'CREATE TABLE three (d); INSERT INTO one VALUES (2, 2); THIS IS NOT SQL;',
    };

    it('brings an older database up to date, backing it up first', () => {
      closeCleanly(opened([one]));
      expect(backups()).toEqual([]);

      const db = opened([one, two]);
      expect(db.pragma('user_version', { simple: true })).toBe(2);
      expect(tables(db)).toContain('two');
      closeCleanly(db);

      const [backup] = backups();
      expect(backup).toMatch(/^library-.*\.db$/);
      const copy = new Database(join(backupsDir, backup ?? ''), { readonly: true });
      expect(copy.pragma('user_version', { simple: true })).toBe(1);
      expect(copy.pragma('application_id', { simple: true })).toBe(APPLICATION_ID);
      expect(copy.prepare('SELECT a FROM one').all()).toEqual([{ a: 1 }]);
      copy.close();
    });

    it('runs them in order, and only the pending ones', () => {
      closeCleanly(opened([one]));
      const db = opened([one, two]);
      expect(db.prepare('SELECT a FROM one').all()).toEqual([{ a: 1 }]);
      closeCleanly(db);
    });

    it('leaves the database as it was when one fails, with a backup made', () => {
      closeCleanly(opened([one, two]));

      const outcome = open([one, two, broken]);
      expect(outcome).toMatchObject({ kind: 'migration-failed', detail: expect.any(String) as string });
      expect(backups()).toHaveLength(1);

      const db = opened([one, two]);
      expect(db.pragma('user_version', { simple: true })).toBe(2);
      expect(tables(db)).not.toContain('three');
      expect(db.prepare('SELECT COUNT(*) AS n FROM one').get()).toEqual({ n: 1 });
      closeCleanly(db);
    });

    it('rolls back everything when a later migration in one run fails', () => {
      closeCleanly(opened([one]));
      expect(open([one, two, broken])).toMatchObject({ kind: 'migration-failed' });

      const db = opened([one]);
      expect(db.pragma('user_version', { simple: true })).toBe(1);
      expect(tables(db)).not.toContain('two');
      closeCleanly(db);
    });

    it('leaves a brand new file safe to try again', () => {
      expect(open([broken])).toMatchObject({ kind: 'migration-failed' });
      const db = opened([one]);
      expect(db.pragma('user_version', { simple: true })).toBe(1);
      closeCleanly(db);
    });

    it('does not back up when there is nothing in the file yet', () => {
      expect(backups()).toEqual([]);
      closeCleanly(opened([one, two]));
      expect(backups()).toEqual([]);
    });

    it('calls a backup that the file system refuses not writable, and leaves the database as it was', () => {
      closeCleanly(opened([one]));
      writeFileSync(backupsDir, 'a file where the backups folder should be');

      const outcome = open([one, two]);

      expect(outcome).toMatchObject({ kind: 'unwritable', message: expect.any(String) as string });
      rmSync(backupsDir);
      const db = opened([one]);
      expect(db.pragma('user_version', { simple: true })).toBe(1);
      closeCleanly(db);
    });
  });

  describe('closing', () => {
    it('leaves a complete .db file behind, with no WAL', () => {
      const db = opened();
      db.prepare("INSERT INTO library_meta (key, value) VALUES ('complete', 'yes')").run();
      closeCleanly(db);

      expect(existsSync(`${dbPath}-wal`)).toBe(false);
      expect(existsSync(`${dbPath}-shm`)).toBe(false);

      const copyPath = join(dir, 'copied.db');
      writeFileSync(copyPath, readFileSync(dbPath));
      const copy = new Database(copyPath, { readonly: true });
      expect(copy.prepare("SELECT value FROM library_meta WHERE key = 'complete'").get()).toEqual({ value: 'yes' });
      copy.close();
    });
  });
});
