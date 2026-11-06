/*
 * What Settings' Data tab drives: things the app holds that only ever get fetched or worked out when asked. Each module
 * brings a Dataset, and this runs them, remembers when, and says how it's going. Nothing here starts by itself.
 */

import { DATASET_IDS, type DataState, type DatasetId, type DatasetState } from '@shared/domain';
import type { EventPayload } from '@shared/ipc/contract';
import type { EventName } from '@shared/ipc/channels';
import { err, ok, type Result } from '@shared/result';
import type { Connection } from '@main/db/connection';
import type { HandlerGroup } from '@main/ipc';
import type { Library } from '@main/library/library';

const EMIT_INTERVAL_MS = 250;
const STOP_GRACE_MS = 6_000;

export type DatasetProgress = { done: number; failed: number; total: number };
export type DatasetOutcome = { note: string | null };
export type DatasetRun = { cancel: () => void; finished: Promise<DatasetOutcome> };

export type Dataset = {
  counts(): Result<{ done: number; missing: number; detail: string | null }>;
  /** Why it can't run at all, in words for the person. The app works without it. */
  problem(): string | null;
  /** When it has its own idea of that, as a scan has. */
  lastRunAt?: () => number | null;
  start(onProgress: (progress: DatasetProgress) => void): Result<DatasetRun>;
};

type Deps = {
  library: Pick<Library, 'perConnection' | 'onStatus' | 'folder'>;
  datasets: Record<DatasetId, Dataset>;
  emit: <E extends EventName>(event: E, payload: EventPayload<E>) => void;
  log: { warn: (...details: unknown[]) => void; error: (...details: unknown[]) => void };
  now: () => number;
};

function createQueries(db: Connection) {
  const read = db.prepare<[string], { value: string }>('SELECT value FROM library_meta WHERE key = ?');
  const write = db.prepare<[string, string]>(
    'INSERT INTO library_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  );
  const key = (id: DatasetId) => `dataset_last_run_${id}`;
  return {
    lastRun(id: DatasetId): number | null {
      const at = read.get(key(id))?.value;
      return at === undefined ? null : Number(at);
    },
    setLastRun: (id: DatasetId, at: number) => write.run(key(id), String(at)),
  };
}

type Running = { run: DatasetRun; progress: DatasetProgress; settled: Promise<void> };

export type Datasets = ReturnType<typeof createDatasets>;

export function createDatasets({ library, datasets, emit, log, now }: Deps) {
  const queries = library.perConnection(createQueries);
  const running = new Map<DatasetId, Running>();
  const notes = new Map<DatasetId, string | null>();
  const counted = new Map<DatasetId, ReturnType<Dataset['counts']>>();
  let isRunningAll = false;
  let wantsAllStopped = false;
  let emitTimer: ReturnType<typeof setTimeout> | null = null;

  // Counting takes a few milliseconds on main, too many to do with every bit of progress.
  function countsOf(id: DatasetId, fresh: boolean): ReturnType<Dataset['counts']> {
    const known = counted.get(id);
    if (known !== undefined && !fresh) return known;
    const counts = datasets[id].counts();
    counted.set(id, counts);
    return counts;
  }

  function stateOf(id: DatasetId, fresh: boolean): DatasetState {
    const dataset = datasets[id];
    const counts = countsOf(id, fresh);
    const lastRun = queries((stored) => stored.lastRun(id));
    const job = running.get(id);
    return {
      id,
      done: counts.ok ? counts.value.done : 0,
      missing: counts.ok ? counts.value.missing : 0,
      detail: counts.ok ? counts.value.detail : null,
      lastRunAt: dataset.lastRunAt?.() ?? (lastRun.ok ? lastRun.value : null),
      progress: job?.progress ?? null,
      problem: dataset.problem(),
      note: notes.get(id) ?? null,
    };
  }

  function state(fresh = true): DataState {
    return { datasets: DATASET_IDS.map((id) => stateOf(id, fresh)), isRunningAll };
  }

  function emitNow(fresh = true): void {
    if (emitTimer !== null) clearTimeout(emitTimer);
    emitTimer = null;
    emit('data.state', state(fresh));
  }

  function emitSoon(): void {
    emitTimer ??= setTimeout(() => emitNow(false), EMIT_INTERVAL_MS);
  }

  function start(id: DatasetId): Result<void> {
    if (running.has(id)) return ok();
    const dataset = datasets[id];
    const problem = dataset.problem();
    if (problem !== null) return err('file_missing', problem);

    const folder = library.folder();
    const started = dataset.start((progress) => {
      const job = running.get(id);
      if (job !== undefined) job.progress = progress;
      emitSoon();
    });
    if (!started.ok) return started;

    notes.delete(id);
    const job: Running = {
      run: started.value,
      progress: { done: 0, failed: 0, total: 0 },
      settled: started.value.finished
        .then(({ note }) => {
          notes.set(id, note);
          // Ids and times belong to the library it started in.
          if (library.folder() === folder) queries((stored) => stored.setLastRun(id, now()));
        })
        .catch((error: unknown) => log.error(`Updating ${id} failed`, error))
        .finally(() => {
          running.delete(id);
          emitNow();
        }),
    };
    running.set(id, job);
    emitNow();
    return ok();
  }

  /** In order, and past one that can't run or fails. Waits for one that's already going. */
  async function updateAll(): Promise<void> {
    isRunningAll = true;
    wantsAllStopped = false;
    emitNow();
    for (const id of DATASET_IDS) {
      if (wantsAllStopped) break;
      const started = start(id);
      if (!started.ok) log.warn(`Skipped ${id} in Update everything`, started.error.message);
      await running.get(id)?.settled;
    }
    isRunningAll = false;
    emitNow();
  }

  const stopFollowingStatus = library.onStatus((status) => {
    if (status.state !== 'ready') cancelAll();
    emitSoon();
  });

  function cancelAll(): void {
    wantsAllStopped = true;
    for (const { run } of running.values()) run.cancel();
  }

  return {
    state: () => state(),
    update: (id: DatasetId) => start(id),
    updateAll(): Result<void> {
      if (!isRunningAll) void updateAll();
      return ok();
    },
    cancel(id: DatasetId | null): Result<void> {
      if (id === null) cancelAll();
      else running.get(id)?.run.cancel();
      return ok();
    },
    /** For quitting. A job that won't stop in time gives up with the process. */
    async stop(): Promise<void> {
      stopFollowingStatus();
      if (emitTimer !== null) clearTimeout(emitTimer);
      cancelAll();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const grace = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, STOP_GRACE_MS);
      });
      await Promise.race([Promise.all([...running.values()].map(({ settled }) => settled)), grace]);
      clearTimeout(timer);
    },
  };
}

export function datasetHandlers(datasets: Datasets) {
  return {
    'data.state': () => ok(datasets.state()),
    'data.update': ({ dataset }) => datasets.update(dataset),
    'data.updateAll': () => datasets.updateAll(),
    'data.cancel': ({ dataset }) => datasets.cancel(dataset),
  } satisfies HandlerGroup;
}
