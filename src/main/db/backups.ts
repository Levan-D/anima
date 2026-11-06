import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { APPLICATION_ID, type Connection } from '@main/db/connection';
import { Worker } from 'node:worker_threads';

const BACKUP_NAME = /^library-.+\.db$/;
const KEEP = 3;
const SIDE_FILES = ['', '-wal', '-shm'];

function stamp(now: number): string {
  return new Date(now).toISOString().replaceAll(/[:.]/g, '-');
}

/** Newest first. The names sort by time. */
export function listBackups(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => BACKUP_NAME.test(name))
    .toSorted()
    .toReversed()
    .map((name) => join(dir, name));
}

/** VACUUM INTO reads one consistent snapshot, so writers carry on while it runs. */
export function createBackup(db: Connection, dir: string, now: number): string {
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.tmp')) rmSync(join(dir, name), { force: true });
  }

  const path = join(dir, `library-${stamp(now)}.db`);
  const temp = `${path}.tmp`;
  db.prepare('VACUUM INTO ?').run(temp);
  renameSync(temp, path);

  for (const old of listBackups(dir).slice(KEEP)) rmSync(old, { force: true });
  return path;
}

function isUsable(path: string): boolean {
  try {
    const db = new Database(path, { readonly: true, fileMustExist: true });
    try {
      return (
        db.pragma('application_id', { simple: true }) === APPLICATION_ID &&
        db.pragma('integrity_check(1)', { simple: true }) === 'ok'
      );
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

/** Never deletes: the bad file stays next to the new one for as long as I want it. */
export function setAside(dbPath: string, now: number): void {
  const target = dbPath.replace(/\.db$/, `.bad-${stamp(now)}.db`);
  for (const suffix of SIDE_FILES) {
    if (existsSync(dbPath + suffix)) renameSync(dbPath + suffix, target + suffix);
  }
}

export function newestUsableBackup(dir: string): string | null {
  return listBackups(dir).find(isUsable) ?? null;
}

export type BackupFinder = (backupsDir: string) => Promise<string | null>;

/** newestUsableBackup in a worker: the full check takes seconds on a whole library, and main would stop for them. */
export function findBackupInWorker(workerPath: string): BackupFinder {
  return (backupsDir) =>
    new Promise((resolve) => {
      const worker = new Worker(workerPath, { workerData: backupsDir });
      worker.once('message', (found: string | null) => resolve(found));
      // Whatever went wrong, there's no backup it could vouch for. Exiting first means the same.
      worker.once('error', () => resolve(null));
      worker.once('exit', () => resolve(null));
    });
}

/** Copied first, so a full disk leaves everything where it was. */
export function putBackupInPlace(backup: string, dbPath: string, now: number): void {
  const copy = `${dbPath}.restoring`;
  copyFileSync(backup, copy);
  setAside(dbPath, now);
  renameSync(copy, dbPath);
}
