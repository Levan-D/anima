import { statSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { errorText } from '@shared/result';
import { createBackup, listBackups } from '@main/db/backups';
import { connect, isCorruption, type Connection } from '@main/db/connection';

const BACKUP_EVERY_MS = 24 * 60 * 60 * 1000;
const STOP_GRACE_MS = 3_000;

export type MaintenanceJob = {
  dbPath: string;
  backupsDir: string;
  now: number;
};

export type MaintenanceEvent =
  { type: 'check'; problem: string | null } | { type: 'backup'; path: string } | { type: 'failed'; message: string };

/** integrity_check, because quick_check doesn't look inside indexes, and a damaged one quietly returns fewer rows. */
function check(db: Connection): string | null {
  try {
    const result = db.pragma('integrity_check(1)', { simple: true }) as string;
    return result === 'ok' ? null : result;
  } catch (error) {
    if (isCorruption(error)) return errorText(error);
    throw error;
  }
}

function isBackupDue(backupsDir: string, now: number): boolean {
  const newest = listBackups(backupsDir)[0];
  return newest === undefined || now - statSync(newest).mtimeMs >= BACKUP_EVERY_MS;
}

function hasFiles(db: Connection): boolean {
  return db.prepare('SELECT 1 FROM files LIMIT 1').get() !== undefined;
}

/** Runs in a short-lived worker, because both of these take as long as the database is big. */
export function runMaintenance({ dbPath, backupsDir, now }: MaintenanceJob, post: (event: MaintenanceEvent) => void) {
  const db = connect(dbPath);
  try {
    const problem = check(db);
    post({ type: 'check', problem });
    if (problem === null && hasFiles(db) && isBackupDue(backupsDir, now)) {
      post({ type: 'backup', path: createBackup(db, backupsDir, now) });
    }
  } catch (error) {
    post({ type: 'failed', message: errorText(error) });
  } finally {
    db.close();
  }
}

export type RunningMaintenance = {
  /** Waits for it to finish by itself, and ends it if it won't. A half-written backup doesn't count. */
  stop(): Promise<void>;
};

export type MaintenanceRunner = (job: MaintenanceJob, onEvent: (event: MaintenanceEvent) => void) => RunningMaintenance;

export function maintenanceInWorker(workerPath: string): MaintenanceRunner {
  return (job, onEvent) => {
    const worker = new Worker(workerPath, { workerData: job });
    const exited = new Promise<void>((resolve) => {
      worker.once('exit', () => resolve());
    });
    worker.on('message', (event: MaintenanceEvent) => onEvent(event));
    worker.on('error', (error: unknown) => onEvent({ type: 'failed', message: errorText(error) }));
    return {
      stop: async () => {
        // A terminate that lands while the worker is loading the SQLite binding aborts the whole process, main included.
        let timer: ReturnType<typeof setTimeout> | undefined;
        const grace = new Promise<void>((resolve) => {
          timer = setTimeout(resolve, STOP_GRACE_MS);
        });
        await Promise.race([exited, grace]);
        clearTimeout(timer);
        await worker.terminate();
      },
    };
  };
}
