/*
 * Main's half of the art cache. It answers art:// requests, and decides what the worker should do:
 * nothing is started for a hash the library doesn't know, and nothing at all when the cache is complete.
 */
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { ArtSize } from '@shared/domain';
import { errorText } from '@shared/result';
import { exists, fullImagePath, thumbnailPath } from '@main/library/artPaths';
import type { ArtJob, ArtJobResult } from '@main/library/artQueue';

const REQUEST_TIMEOUT_MS = 15_000;
const STOP_GRACE_MS = 3_000;
const CHECKS_AT_ONCE = 16;

export type ArtWorkerConfig = {
  cacheDir: string;
  ffmpegPath: string | null;
};

export type ArtWorkerCommand =
  { type: 'job'; job: ArtJob; urgent: boolean } | { type: 'drop-background' } | { type: 'stop' };

export type ArtWorkerEvent = { type: 'done'; result: ArtJobResult } | { type: 'failed'; message: string };

type ArtWorkerHandle = {
  post(command: ArtWorkerCommand): void;
  terminate(): Promise<void>;
  /** Resolves once the worker has ended, however it ended. */
  exited: Promise<void>;
};

export type ArtWorkerStarter = (config: ArtWorkerConfig, onEvent: (event: ArtWorkerEvent) => void) => ArtWorkerHandle;

export function artInWorker(workerPath: string): ArtWorkerStarter {
  return (config, onEvent) => {
    const worker = new Worker(workerPath, { workerData: config });
    worker.on('message', onEvent);
    const exited = new Promise<void>((resolve) => {
      worker.once('exit', () => resolve());
    });
    worker.on('error', (error: unknown) => onEvent({ type: 'failed', message: errorText(error) }));
    return {
      post: (command) => worker.postMessage(command),
      terminate: async () => {
        await worker.terminate();
      },
      exited,
    };
  };
}

export type ArtCatalog = {
  mimeOf(hash: string): string | null;
  /** The job for one image, with its sources as absolute paths. */
  jobFor(hash: string): ArtJob | null;
  /** Null when they couldn't be read, which doesn't mean there are none. */
  rows(): { hash: string; mime: string; color: string | null }[] | null;
  saveColor(hash: string, color: string): void;
};

type ArtFile = {
  path: string;
  mime: string;
};

type Options = {
  cacheDir: string;
  ffmpegPath: string | null;
  start: ArtWorkerStarter;
  log: { warn: (...details: unknown[]) => void; error: (...details: unknown[]) => void };
};

export type ArtCache = ReturnType<typeof createArtCache>;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function createArtCache({ cacheDir, ffmpegPath, start, log }: Options) {
  let catalog: ArtCatalog | null = null;
  let worker: ArtWorkerHandle | null = null;
  const pending = new Map<string, { promise: Promise<void>; resolve: () => void; urgent: boolean }>();
  let cancelPass: (() => void) | null = null;

  function settle(hash: string): void {
    pending.get(hash)?.resolve();
    pending.delete(hash);
  }

  function settleAll(): void {
    for (const hash of [...pending.keys()]) settle(hash);
  }

  function onEvent(event: ArtWorkerEvent): void {
    switch (event.type) {
      case 'done': {
        const { hash, color, ok, message } = event.result;
        if (color !== null) {
          try {
            catalog?.saveColor(hash, color);
          } catch (error) {
            log.warn('Could not save an art color', error);
          }
        }
        if (!ok && message !== 'Cancelled') log.warn('Could not cache art', hash, message);
        settle(hash);
        return;
      }
      case 'failed':
        log.error('The art worker failed', event.message);
    }
  }

  function ensureWorker(): ArtWorkerHandle {
    if (worker) return worker;
    const started = start({ cacheDir, ffmpegPath }, onEvent);
    worker = started;
    void started.exited.then(() => {
      if (worker === started) worker = null;
      settleAll();
    });
    return started;
  }

  function request(job: ArtJob, urgent: boolean): Promise<void> {
    const existing = pending.get(job.hash);
    if (existing && (existing.urgent || !urgent)) return existing.promise;

    ensureWorker().post({ type: 'job', job, urgent });
    if (existing) {
      existing.urgent = true;
      return existing.promise;
    }

    let resolve = (): void => {};
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    pending.set(job.hash, { promise, resolve, urgent });
    return promise;
  }

  async function locate(hash: string, mime: string, size: ArtSize, fallBack: boolean): Promise<ArtFile | null> {
    if (size === 'thumb') {
      const thumb = thumbnailPath(cacheDir, hash);
      if (await exists(thumb)) return { path: thumb, mime: 'image/jpeg' };
      if (!fallBack) return null;
    }
    const full = fullImagePath(cacheDir, hash, mime);
    return (await exists(full)) ? { path: full, mime } : null;
  }

  async function needsWork({ hash, mime, color }: { hash: string; mime: string; color: string | null }) {
    if (!(await exists(fullImagePath(cacheDir, hash, mime)))) return true;
    if (ffmpegPath === null) return false;
    return color === null || !(await exists(thumbnailPath(cacheDir, hash)));
  }

  return {
    cacheDir,

    use(next: ArtCatalog | null): void {
      catalog = next;
      cancelPass?.();
    },

    /** The file for an art:// request, or null, which the handler turns into a 404. */
    async resolve(hash: string, size: ArtSize): Promise<ArtFile | null> {
      const known = catalog;
      const mime = known?.mimeOf(hash) ?? null;
      if (known === null || mime === null) return null;

      const hit = await locate(hash, mime, size, ffmpegPath === null);
      if (hit) return hit;

      const job = known.jobFor(hash);
      if (job === null) return null;
      await withTimeout(request(job, true), REQUEST_TIMEOUT_MS, undefined);
      return locate(hash, mime, size, true);
    },

    /** Starts nothing if everything's already in the cache, as it is on most launches. */
    async runBackgroundPass(onProgress?: (done: number, total: number) => void): Promise<void> {
      cancelPass?.();
      const known = catalog;
      if (known === null) return;

      let cancelled = false;
      const cancel = () => {
        cancelled = true;
        cancelPass = null;
        worker?.post({ type: 'drop-background' });
      };
      cancelPass = cancel;
      const finish = () => {
        if (cancelPass === cancel) cancelPass = null;
      };

      const rows = known.rows() ?? [];
      const stale: typeof rows = [];
      let next = 0;
      await Promise.all(
        Array.from({ length: CHECKS_AT_ONCE }, async () => {
          while (!cancelled && next < rows.length) {
            const row = rows[next++];
            if (row && (await needsWork(row))) stale.push(row);
          }
        }),
      );
      if (cancelled || stale.length === 0) {
        finish();
        return;
      }

      let done = 0;
      onProgress?.(0, stale.length);
      await Promise.all(
        stale.map(async ({ hash }) => {
          const job = known.jobFor(hash);
          if (job) await request(job, false);
          done++;
          onProgress?.(done, stale.length);
        }),
      );
      finish();
    },

    stopBackgroundPass(): void {
      cancelPass?.();
    },

    /**
     * Removes cache files whose hash has no art row left. It's only ever a few, and it's all async, so main stays free.
     * A library with no art at all is more likely the wrong folder than a reason to throw away minutes of work.
     */
    async prune(): Promise<void> {
      const rows = catalog?.rows() ?? null;
      if (rows === null || rows.length === 0) return;
      const keep = new Set(rows.map(({ hash }) => hash));
      for (const folder of await readdir(cacheDir).catch(() => [] as string[])) {
        const path = join(cacheDir, folder);
        for (const name of await readdir(path).catch(() => [] as string[])) {
          if (!keep.has(name.slice(0, name.indexOf('.')))) await rm(join(path, name), { force: true });
        }
      }
    },

    async sizeBytes(): Promise<number> {
      let total = 0;
      for (const folder of await readdir(cacheDir).catch(() => [] as string[])) {
        const path = join(cacheDir, folder);
        const names = await readdir(path).catch(() => [] as string[]);
        const sizes = await Promise.all(
          names.map((name) =>
            stat(join(path, name)).then(
              ({ size }) => size,
              () => 0,
            ),
          ),
        );
        total += sizes.reduce((sum, size) => sum + size, 0);
      }
      return total;
    },

    async stop(): Promise<void> {
      catalog = null;
      cancelPass?.();
      const handle = worker;
      if (handle === null) return;
      handle.post({ type: 'stop' });
      await withTimeout(handle.exited, STOP_GRACE_MS, undefined);
      await handle.terminate();
    },
  };
}
