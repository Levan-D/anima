/*
 * The Library report on main: every read is its own short worker, so main never waits on them. It only starts what's
 * needed to answer, and tells the page when the answers change. Nothing here touches a music file except to read it.
 */
import { Worker } from 'node:worker_threads';
import type { LibraryReport, Track } from '@shared/domain';
import type { EventName } from '@shared/ipc/channels';
import type { EventPayload } from '@shared/ipc/contract';
import { err, errorText, ok, type Result } from '@shared/result';
import type { HandlerGroup } from '@main/ipc';
import type { ArtCache } from '@main/library/artCache';
import type { Library } from '@main/library/library';
import { buildReport, checkById, type StoredReport } from './checks';
import type { ReportAnswers, ReportJob } from './jobs';

const NOT_OPEN = "The library isn't open";

type Running<T> = {
  answer: Promise<Result<T>>;
  stop: () => Promise<void>;
};

export type ReportRunner = <K extends ReportJob['kind']>(
  job: Extract<ReportJob, { kind: K }>,
) => Running<ReportAnswers[K]>;

type WorkerAnswer<T> = { ok: true; value: T } | { ok: false; message: string };

export function reportInWorker(workerPath: string): ReportRunner {
  return <K extends ReportJob['kind']>(job: Extract<ReportJob, { kind: K }>) => {
    const worker = new Worker(workerPath, { workerData: job });
    const answer = new Promise<Result<ReportAnswers[K]>>((resolve) => {
      worker.once('message', (message: WorkerAnswer<ReportAnswers[K]>) => {
        resolve(message.ok ? ok(message.value) : err('unexpected', message.message));
      });
      worker.once('error', (error: unknown) => resolve(err('unexpected', errorText(error))));
      worker.once('exit', () => resolve(err('unexpected', 'The report stopped before it finished')));
    });
    return {
      answer,
      stop: async () => {
        await worker.terminate();
      },
    };
  };
}

type Deps = {
  library: Pick<Library, 'databasePath' | 'folder' | 'scanState'>;
  art: Pick<ArtCache, 'measure'>;
  run: ReportRunner;
  emit: <E extends EventName>(event: E, payload: EventPayload<E>) => void;
  log: { warn: (...details: unknown[]) => void };
};

export type Report = ReturnType<typeof createReport>;

export function createReport({ library, art, run, emit, log }: Deps) {
  let readingFiles: Running<number> | null = null;
  let isMeasuring = false;
  // What couldn't be read last time, so a page that keeps being opened doesn't keep trying the same few.
  let unreadAfterLastTry: number | null = null;
  let unmeasuredAfterLastTry: number | null = null;

  const announce = () => emit('library.changed', { scopes: ['report'] });

  function startReadingFiles(dbPath: string, root: string): void {
    const running = run<'file-facts'>({ kind: 'file-facts', dbPath, root });
    readingFiles = running;
    void running.answer.then((answer) => {
      readingFiles = null;
      if (answer.ok) unreadAfterLastTry = answer.value;
      else log.warn('Could not read what the report needs from the files', answer.error.message);
      announce();
    });
  }

  function startMeasuring(unmeasured: number): void {
    isMeasuring = true;
    art
      .measure()
      .catch((error: unknown) => log.warn('Could not measure the art', error))
      .finally(() => {
        isMeasuring = false;
        unmeasuredAfterLastTry = unmeasured;
        announce();
      });
  }

  /** Waits for a scan, which writes these itself for whatever it reads. */
  function fillIn({ unreadFiles, unmeasuredArt }: StoredReport, dbPath: string): void {
    const isScanning = library.scanState().phase !== 'idle';
    const root = library.folder();
    if (
      !isScanning &&
      root !== null &&
      readingFiles === null &&
      unreadFiles > 0 &&
      unreadFiles !== unreadAfterLastTry
    ) {
      startReadingFiles(dbPath, root);
    }
    if (!isScanning && !isMeasuring && unmeasuredArt > 0 && unmeasuredArt !== unmeasuredAfterLastTry) {
      startMeasuring(unmeasuredArt);
    }
  }

  return {
    async get(): Promise<Result<LibraryReport>> {
      const dbPath = library.databasePath();
      if (dbPath === null) return err('no_library', NOT_OPEN);
      const stored = await run<'report'>({ kind: 'report', dbPath }).answer;
      if (!stored.ok) return stored;

      fillIn(stored.value, dbPath);
      const isScanning = library.scanState().phase !== 'idle';
      return ok(
        buildReport(stored.value, {
          fileFacts: stored.value.unreadFiles > 0 && (readingFiles !== null || isScanning),
          artSizes: stored.value.unmeasuredArt > 0 && (isMeasuring || isScanning),
        }),
      );
    },

    async tracks(checkId: string): Promise<Result<Track[]>> {
      const dbPath = library.databasePath();
      if (dbPath === null) return err('no_library', NOT_OPEN);
      if (checkById(checkId) === null) return err('not_found', "The report doesn't have that check");
      return run<'tracks'>({ kind: 'tracks', dbPath, checkId }).answer;
    },

    /** What it read so far is saved in batches, and the rest waits for the next report. */
    async stop(): Promise<void> {
      await readingFiles?.stop();
    },
  };
}

export function reportHandlers(report: Report) {
  return {
    'report.get': () => report.get(),
    'report.tracks': ({ checkId }) => report.tracks(checkId),
  } satisfies HandlerGroup;
}
