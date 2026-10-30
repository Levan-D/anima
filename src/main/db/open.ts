import { statSync } from 'node:fs';
import Database from 'better-sqlite3';
import { errorText } from '@shared/result';
import { createBackup, listBackups } from '@main/db/backups';
import {
  APPLICATION_ID,
  BUSY_TIMEOUT_MS,
  isCorruption,
  isFileSystemError,
  sqliteCode,
  whyNotWritable,
  type Connection,
} from '@main/db/connection';
import { MIGRATIONS, type Migration } from '@main/db/migrations';

// Short, because this runs on main: a locked file should become its screen at once, not freeze the window first.
const OPEN_BUSY_TIMEOUT_MS = 250;

type OpenOutcome =
  | { kind: 'open'; db: Connection }
  | { kind: 'corrupt'; cause: 'damaged' | 'not-ours' | 'lost'; detail: string }
  | { kind: 'too-new' }
  /** `message` is for the screen, `detail` for the log. */
  | { kind: 'unwritable'; message: string; detail: string }
  | { kind: 'migration-failed'; detail: string };

type Options = {
  backupsDir: string;
  now: number;
  migrations?: Migration[];
  /** The caller set the old file aside on purpose, so an empty one beside backups is what it asked for. */
  startFresh?: boolean;
};

function fileSize(path: string): number {
  return statSync(path, { throwIfNoEntry: false })?.size ?? 0;
}

function migrate(db: Connection, pending: Migration[]): void {
  db.transaction(() => {
    for (const { version, sql } of pending) {
      db.exec(sql);
      db.pragma(`user_version = ${version}`);
    }
  }).immediate();
}

/**
 * Opening a read-only file succeeds, and every write after that fails, so this asks before anything relies on it.
 * It takes a real write to find out: on a read-only file SQLite quietly turns BEGIN IMMEDIATE into a read.
 */
function assertWritable(db: Connection, version: number): void {
  db.exec(`BEGIN IMMEDIATE; PRAGMA user_version = ${version}; ROLLBACK`);
}

function prepare(db: Connection, isNew: boolean, { backupsDir, now, migrations = MIGRATIONS }: Options): OpenOutcome {
  const applicationId = db.pragma('application_id', { simple: true });
  const version = db.pragma('user_version', { simple: true }) as number;
  const latest = migrations.at(-1)?.version ?? 0;

  if (!isNew && applicationId !== APPLICATION_ID) {
    return { kind: 'corrupt', cause: 'not-ours', detail: "The file has another program's application id" };
  }
  if (version > latest) return { kind: 'too-new' };

  // Set first, so there's never a moment when a non-empty file doesn't say whose it is.
  if (isNew) db.pragma(`application_id = ${APPLICATION_ID}`);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  const pending = migrations.filter((migration) => migration.version > version);
  if (pending.length === 0) {
    assertWritable(db, version);
    return { kind: 'open', db };
  }

  if (version > 0) createBackup(db, backupsDir, now);
  try {
    migrate(db, pending);
  } catch (error) {
    return { kind: 'migration-failed', detail: errorText(error) };
  }
  return { kind: 'open', db };
}

function classify(error: unknown): OpenOutcome {
  if (isCorruption(error)) return { kind: 'corrupt', cause: 'damaged', detail: errorText(error) };
  // A full disk, a locked file, a folder gone read-only: none of them is the database's fault.
  if (sqliteCode(error) !== null || isFileSystemError(error)) {
    return { kind: 'unwritable', message: whyNotWritable(error), detail: errorText(error) };
  }
  throw error;
}

/** Reads nothing it could damage until it knows the file is this app's, and not from a newer version of it. */
export function openDatabase(path: string, options: Options): OpenOutcome {
  const isNew = fileSize(path) === 0;
  // An interrupted copy leaves this. Starting empty would lose the playlists, and the rotation would soon take the backups.
  if (isNew && !options.startFresh && listBackups(options.backupsDir).length > 0) {
    return { kind: 'corrupt', cause: 'lost', detail: 'The database is empty or gone, and there are backups beside it' };
  }

  let db: Connection | null = null;
  try {
    db = new Database(path, { timeout: OPEN_BUSY_TIMEOUT_MS });
    const outcome = prepare(db, isNew, options);
    if (outcome.kind === 'open') db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
    else db.close();
    return outcome;
  } catch (error) {
    db?.close();
    return classify(error);
  }
}

export function closeCleanly(db: Connection): void {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }
}
