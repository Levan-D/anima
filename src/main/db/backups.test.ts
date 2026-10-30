import { existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackup, listBackups, newestUsableBackup, putBackupInPlace, setAside } from '@main/db/backups';
import type { Connection } from '@main/db/connection';
import { runMaintenance, type MaintenanceEvent } from '@main/db/maintenance';
import { closeCleanly } from '@main/db/open';
import { closeTestDatabase, openTestDatabase, tempDir } from '@main/library/testFixtures';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

let dir: string;
let dbPath: string;
let backupsDir: string;
let db: Connection;

function addFileRow(relPath = 'a.flac'): void {
  db.prepare(
    `INSERT INTO files (rel_path, size_bytes, mtime_ms, codec, duration_ms, scanned_at)
     VALUES (?, 1, 1, 'FLAC', 1, 1)`,
  ).run(relPath);
}

function fileRows(path: string): number {
  const copy = new Database(path, { readonly: true });
  const { n } = copy.prepare('SELECT COUNT(*) AS n FROM files').get() as { n: number };
  copy.close();
  return n;
}

/** Damages the data pages, leaving the header that says it's a database. */
function damage(path: string): void {
  const bytes = Buffer.from(readFileSync(path));
  const pageSize = bytes.readUInt16BE(16);
  for (let offset = pageSize * 2; offset < bytes.length; offset++) bytes[offset] = (offset * 31) & 0xff;
  writeFileSync(path, bytes);
}

function addArtistRow(): void {
  db.prepare("INSERT INTO artists (name, sort_name) VALUES ('Someone', 'someone')").run();
}

/** Leaves an index with the right number of entries but the wrong things in them, which only integrity_check looks at. */
function damageAnIndex(path: string): void {
  const file = new Database(path);
  const { sql } = file
    .prepare<[], { sql: string }>("SELECT sql FROM sqlite_schema WHERE name = 'artists_sort'")
    .get() ?? {
    sql: '',
  };
  file.exec('DROP INDEX artists_sort; CREATE INDEX artists_sort ON artists (name)');
  file.unsafeMode(true);
  file.pragma('writable_schema = ON');
  file.prepare("UPDATE sqlite_schema SET sql = ? WHERE name = 'artists_sort'").run(sql);
  file.close();

  const reopened = new Database(path, { readonly: true });
  expect(reopened.pragma('quick_check(1)', { simple: true })).toBe('ok');
  expect(reopened.pragma('integrity_check(1)', { simple: true })).toContain('missing from index artists_sort');
  reopened.close();
}

beforeEach(() => {
  dir = tempDir('backups');
  ({ dbPath, backupsDir, db } = openTestDatabase(dir));
  return () => closeTestDatabase(db);
});

describe('createBackup', () => {
  it('writes a consistent copy that a writer can carry on past', () => {
    addFileRow();
    const path = createBackup(db, backupsDir, NOW);
    addFileRow('b.flac');
    expect(fileRows(path)).toBe(1);
    expect(fileRows(dbPath)).toBe(2);
  });

  it('keeps the last 3', () => {
    const made = [1, 2, 3, 4, 5].map((n) => createBackup(db, backupsDir, NOW + n * 1000));
    expect(listBackups(backupsDir)).toEqual([made[4], made[3], made[2]]);
    expect(existsSync(made[0] ?? '')).toBe(false);
  });

  it('leaves no temporary file behind, and clears one left by a crash', () => {
    mkdirSync(backupsDir);
    writeFileSync(join(backupsDir, 'leftover.db.tmp'), '');
    createBackup(db, backupsDir, NOW);
    expect(readdirSync(backupsDir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});

describe('listBackups', () => {
  it('is empty when the folder does not exist yet', () => {
    expect(listBackups(join(dir, 'nope'))).toEqual([]);
  });

  it('ignores anything that is not a backup', () => {
    createBackup(db, backupsDir, NOW);
    writeFileSync(join(backupsDir, 'notes.txt'), '');
    writeFileSync(join(backupsDir, 'half-written.db.tmp'), '');
    expect(listBackups(backupsDir)).toHaveLength(1);
  });
});

describe('setAside', () => {
  it('renames the database and its side files, deleting nothing', () => {
    addFileRow();
    db.close();
    writeFileSync(`${dbPath}-wal`, 'wal');
    writeFileSync(`${dbPath}-shm`, 'shm');

    setAside(dbPath, NOW);

    expect(existsSync(dbPath)).toBe(false);
    expect(existsSync(`${dbPath}-wal`)).toBe(false);
    const names = readdirSync(dir).filter((name) => name.startsWith('library.bad-'));
    expect(names).toHaveLength(3);
    expect(names.some((name) => name.endsWith('.db'))).toBe(true);
    expect(names.some((name) => name.endsWith('.db-wal'))).toBe(true);
    expect(names.some((name) => name.endsWith('.db-shm'))).toBe(true);
  });

  it('is fine with nothing there', () => {
    db.close();
    setAside(join(dir, 'nothing.db'), NOW);
  });
});

describe('newestUsableBackup', () => {
  it('finds the newest', () => {
    createBackup(db, backupsDir, NOW);
    const newest = createBackup(db, backupsDir, NOW + 1000);
    expect(newestUsableBackup(backupsDir)).toBe(newest);
  });

  it('passes over a damaged one', () => {
    addFileRow();
    const good = createBackup(db, backupsDir, NOW);
    const bad = createBackup(db, backupsDir, NOW + 1000);
    damage(bad);
    expect(newestUsableBackup(backupsDir)).toBe(good);
  });

  it('passes over one with a damaged index, which a quick check would pass', () => {
    addArtistRow();
    const good = createBackup(db, backupsDir, NOW);
    const bad = createBackup(db, backupsDir, NOW + 1000);
    damageAnIndex(bad);
    expect(newestUsableBackup(backupsDir)).toBe(good);
  });

  it('passes over a file that is not ours', () => {
    const good = createBackup(db, backupsDir, NOW);
    const other = new Database(join(backupsDir, 'library-9999.db'));
    other.exec('CREATE TABLE theirs (a)');
    other.close();
    expect(newestUsableBackup(backupsDir)).toBe(good);
  });

  it('is null when there are none', () => {
    expect(newestUsableBackup(backupsDir)).toBeNull();
  });
});

describe('putBackupInPlace', () => {
  it('sets the bad file aside and copies the backup in', () => {
    addFileRow();
    const backup = createBackup(db, backupsDir, NOW);
    addFileRow('b.flac');
    closeCleanly(db);

    damage(dbPath);
    putBackupInPlace(backup, dbPath, NOW);

    expect(fileRows(dbPath)).toBe(1);
    expect(fileRows(backup)).toBe(1);
    expect(readdirSync(dir).some((name) => name.startsWith('library.bad-'))).toBe(true);
    expect(readdirSync(dir).some((name) => name.endsWith('.restoring'))).toBe(false);
  });

  it('leaves everything where it was when the copy fails', () => {
    closeCleanly(db);
    const before = readFileSync(dbPath);
    expect(() => putBackupInPlace(join(dir, 'no such backup.db'), dbPath, NOW)).toThrow();
    expect(readFileSync(dbPath)).toEqual(before);
    expect(readdirSync(dir).some((name) => name.startsWith('library.bad-'))).toBe(false);
  });
});

describe('runMaintenance', () => {
  function run(now = NOW): MaintenanceEvent[] {
    const events: MaintenanceEvent[] = [];
    runMaintenance({ dbPath, backupsDir, now }, (event) => events.push(event));
    return events;
  }

  it('finds a healthy database healthy', () => {
    expect(run()[0]).toEqual({ type: 'check', problem: null });
  });

  it('backs up after a good check', () => {
    addFileRow();
    expect(run()[1]).toMatchObject({ type: 'backup', path: expect.any(String) as string });
    expect(listBackups(backupsDir)).toHaveLength(1);
  });

  it('has nothing worth backing up in an empty library', () => {
    expect(run()).toHaveLength(1);
    expect(listBackups(backupsDir)).toEqual([]);
  });

  it('backs up at most once a day', () => {
    addFileRow();
    run();
    const [first] = listBackups(backupsDir);
    utimesSync(first ?? '', new Date(NOW), new Date(NOW));

    expect(run(NOW + DAY - 1000).some(({ type }) => type === 'backup')).toBe(false);
    expect(listBackups(backupsDir)).toHaveLength(1);

    expect(run(NOW + DAY + 1000).some(({ type }) => type === 'backup')).toBe(true);
    expect(listBackups(backupsDir)).toHaveLength(2);
  });

  it('reports damage, and does not back up a damaged database', () => {
    addFileRow();
    closeCleanly(db);
    damage(dbPath);

    const events: MaintenanceEvent[] = [];
    runMaintenance({ dbPath, backupsDir, now: NOW }, (event) => events.push(event));

    expect(events[0]).toMatchObject({ type: 'check', problem: expect.any(String) as string });
    expect(events).toHaveLength(1);
    expect(listBackups(backupsDir)).toEqual([]);
  });

  it('notices a damaged index, which a quick check would pass', () => {
    addFileRow();
    addArtistRow();
    closeCleanly(db);
    damageAnIndex(dbPath);

    const events: MaintenanceEvent[] = [];
    runMaintenance({ dbPath, backupsDir, now: NOW }, (event) => events.push(event));

    expect(events[0]).toMatchObject({
      type: 'check',
      problem: expect.stringContaining('missing from index artists_sort') as string,
    });
    expect(listBackups(backupsDir)).toEqual([]);
  });

  it('turns a database it cannot open into a report, and never throws', () => {
    const onEvent = vi.fn();
    expect(() => runMaintenance({ dbPath: join(dir, 'gone', 'library.db'), backupsDir, now: NOW }, onEvent)).toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });
});
