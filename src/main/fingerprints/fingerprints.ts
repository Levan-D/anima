/* What a track sounds like, worked out on request in a worker and kept with the library. See embed.ts for the job. */

import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { err, errorText, ok, type Result } from '@shared/result';
import type { Connection } from '@main/db/connection';
import type { Dataset, DatasetOutcome } from '@main/datasets/datasets';
import type { Library } from '@main/library/library';
import type { FingerprintEvent, FingerprintJob } from './embed';
import { FINGERPRINT_MODEL } from './model';

const CANCEL_GRACE_MS = 5_000;
const ANNOUNCE_EVERY = 100;
const NO_MODEL = 'The sound model is missing. Run npm run fetch:binaries, or reinstall the app.';
const NO_FFMPEG = "ffmpeg isn't where it should be, so nothing can be decoded";

type RunningJob = {
  cancel: () => void;
  finished: Promise<void>;
};

export type FingerprintRunner = (job: FingerprintJob, onEvent: (event: FingerprintEvent) => void) => RunningJob;

export function fingerprintsInWorker(workerPath: string): FingerprintRunner {
  return (job, onEvent) => {
    const worker = new Worker(workerPath, { workerData: job });
    let settled = false;
    const report = (event: FingerprintEvent) => {
      if (event.type !== 'progress') settled = true;
      onEvent(event);
    };
    worker.on('message', report);
    worker.on('error', (error: unknown) => {
      if (!settled) report({ type: 'failed', message: errorText(error) });
    });
    const finished = new Promise<void>((resolve) => {
      worker.once('exit', () => {
        if (!settled) report({ type: 'failed', message: 'The worker stopped before it finished' });
        resolve();
      });
    });
    return {
      cancel() {
        worker.postMessage('cancel');
        // A terminate while it's loading a native binding takes the whole process down, so it only comes after a wait.
        setTimeout(() => void worker.terminate(), CANCEL_GRACE_MS).unref();
      },
      finished,
    };
  };
}

function createQueries(db: Connection) {
  const counts = db.prepare<[string], { total: number; done: number | null }>(`
    SELECT COUNT(*) AS total, SUM(p.audio_hash IS NOT NULL) AS done
    FROM tracks t
    JOIN files f ON f.id = t.file_id
    LEFT JOIN fingerprints p
      ON p.audio_hash = f.audio_hash AND p.start_ms = t.start_ms AND p.end_ms = COALESCE(t.end_ms, -1) AND p.model = ?
    WHERE f.missing_since IS NULL AND f.audio_hash IS NOT NULL
  `);
  return { counts: () => counts.get(FINGERPRINT_MODEL) ?? { total: 0, done: 0 } };
}

type Deps = {
  library: Pick<Library, 'perConnection' | 'folder' | 'storedInfo' | 'markChanged'>;
  modelPath: string;
  ffmpegPath: string | null;
  run: FingerprintRunner;
  announce: () => void;
  log: { warn: (...details: unknown[]) => void };
  now: () => number;
  exists?: (path: string) => boolean;
};

export function createFingerprintDataset(deps: Deps): Dataset {
  const { library, modelPath, ffmpegPath, run, announce, log, now, exists = existsSync } = deps;
  const queries = library.perConnection(createQueries);

  function outcomeWords(done: number, failed: number, cancelled: boolean): string | null {
    if (failed === 0) return null;
    const words = `${failed.toLocaleString('en')} couldn't be read, and will be tried again next time`;
    return cancelled || done > 0 ? words : `None could be read: ${failed.toLocaleString('en')} tried`;
  }

  return {
    counts() {
      const counted = queries(({ counts }) => counts());
      if (!counted.ok) return counted;
      const done = counted.value.done ?? 0;
      return ok({ done, missing: counted.value.total - done, detail: null });
    },
    problem() {
      if (!exists(modelPath)) return NO_MODEL;
      return ffmpegPath === null ? NO_FFMPEG : null;
    },
    start(_options, onProgress): Result<{ cancel: () => void; finished: Promise<DatasetOutcome> }> {
      const dbPath = library.storedInfo().databasePath;
      const root = library.folder();
      if (dbPath === null || root === null || ffmpegPath === null) return err('no_library', "The library isn't open");

      let note: string | null = null;
      let sinceAnnounced = 0;
      const told = () => {
        library.markChanged();
        announce();
      };
      const running = run({ dbPath, root, modelPath, ffmpegPath, now: now() }, (event) => {
        switch (event.type) {
          case 'progress':
            onProgress({ done: event.done, failed: event.failed, total: event.total });
            sinceAnnounced += 1;
            if (sinceAnnounced >= ANNOUNCE_EVERY) {
              sinceAnnounced = 0;
              told();
            }
            return;
          case 'finished':
            for (const failure of event.failures) log.warn('Could not fingerprint', failure);
            note = outcomeWords(event.done, event.failed, event.cancelled);
            return;
          case 'failed':
            log.warn('Fingerprinting stopped', event.message);
            note = 'It stopped unexpectedly. The details are in the log.';
        }
      });
      return ok({
        cancel: running.cancel,
        finished: running.finished.then(() => {
          told();
          return { note };
        }),
      });
    },
  };
}
