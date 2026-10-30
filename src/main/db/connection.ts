import Database from 'better-sqlite3';

export type Connection = Database.Database;

export const APPLICATION_ID = 0x4d504c59;
export const BUSY_TIMEOUT_MS = 5_000;

/** A worker's own connection, to a database main has already opened and migrated. */
export function connect(path: string): Connection {
  const db = new Database(path, { fileMustExist: true, timeout: BUSY_TIMEOUT_MS });
  db.pragma('foreign_keys = ON');
  return db;
}

export function sqliteCode(error: unknown): string | null {
  if (!(error instanceof Error) || !('code' in error) || typeof error.code !== 'string') return null;
  return error.code.startsWith('SQLITE_') ? error.code : null;
}

export function isCorruptionCode(code: string | null): boolean {
  return code !== null && (code.startsWith('SQLITE_CORRUPT') || code === 'SQLITE_NOTADB');
}

export function isCorruption(error: unknown): boolean {
  return isCorruptionCode(sqliteCode(error));
}

/** The disk went away or filled up under an open database. */
export function isDiskFailure(error: unknown): boolean {
  const code = sqliteCode(error);
  return (
    code !== null &&
    (code.startsWith('SQLITE_IOERR') ||
      code.startsWith('SQLITE_CANTOPEN') ||
      code.startsWith('SQLITE_READONLY') ||
      code === 'SQLITE_FULL')
  );
}

/** Someone else holds the file. Nothing is wrong with it, and it may well be free in a moment. */
export function isLocked(error: unknown): boolean {
  const code = sqliteCode(error);
  return code !== null && (code.startsWith('SQLITE_BUSY') || code.startsWith('SQLITE_LOCKED'));
}

/** One row was refused, which says nothing about the rows around it or the database. */
export function isRowProblem(error: unknown): boolean {
  const code = sqliteCode(error);
  return (
    code !== null && (code.startsWith('SQLITE_CONSTRAINT') || code === 'SQLITE_MISMATCH' || code === 'SQLITE_TOOBIG')
  );
}

/** A failed call to the file system, as opposed to a bug. */
export function isFileSystemError(error: unknown): boolean {
  return error instanceof Error && 'syscall' in error;
}

function codeOf(error: unknown): string {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : '';
}

/** For the screen that asks me to fix it. The system's own words go to the log. */
export function whyNotWritable(error: unknown): string {
  const code = codeOf(error);
  if (/^(EACCES|EPERM|EROFS|SQLITE_READONLY)/.test(code)) return 'This drive or folder is read-only.';
  if (/^(ENOSPC|SQLITE_FULL)/.test(code)) return 'The drive is full.';
  if (/^(EBUSY|SQLITE_BUSY|SQLITE_LOCKED)/.test(code)) return 'Another program has the database open.';
  if (/^(EEXIST|ENOTDIR)/.test(code)) return 'A file is in the way of the folder the app keeps its data in.';
  return "Windows wouldn't let the app write there.";
}
