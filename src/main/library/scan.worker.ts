import { parentPort, workerData } from 'node:worker_threads';
import { connect, sqliteCode } from '@main/db/connection';
import { errorText } from '@shared/result';
import { runScan } from '@main/library/scan';
import type { ScanEvent, ScanJob } from '@main/library/scanner';

const { root, dbPath, hostname } = workerData as ScanJob;

function post(event: ScanEvent): void {
  parentPort?.postMessage(event);
}

let cancelled = false;
parentPort?.on('message', () => {
  cancelled = true;
});

try {
  const db = connect(dbPath);
  try {
    const outcome = await runScan({
      root,
      db,
      hostname,
      now: Date.now,
      isCancelled: () => cancelled,
      onProgress: (progress) => post({ type: 'progress', progress }),
      onCommit: () => post({ type: 'committed' }),
    });
    post({ type: 'done', outcome });
  } finally {
    db.close();
  }
} catch (error) {
  post({ type: 'failed', message: errorText(error), code: sqliteCode(error) });
} finally {
  parentPort?.close();
}
