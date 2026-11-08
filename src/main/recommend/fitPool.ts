/*
 * A station's fit, split across threads. One fit is 300 passes over the whole library, seconds on one thread, and a grade
 * is one fit per example. The split doesn't change the arithmetic (see stations.ts), so the answer is the one-thread answer.
 */

import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { cancelFit, CONTROL_SLOTS, isCancelled, type FitTask } from './fitShare';
import type { StationLibrary, StationWeights, TrainingSet } from './stations';

/** Threads sit idle this long before they're let go. Starting them again costs a fraction of a fit. */
const IDLE_MS = 60_000;
/** Measured on a 20-thread laptop: 2 threads 6.9 s a fit, 4 3.9 s, 8 2.4 s, 10 2.0 s. The gain flattens out by here. */
const MOST_THREADS = 12;

export type FitHandle = {
  /** Null if cancelled. */
  weights: Promise<StationWeights | null>;
  cancel(): void;
};

export type FitPool = {
  /** Fits run one at a time, in the order they're asked for. */
  fit(library: StationLibrary, set: TrainingSet): FitHandle;
  stop(): Promise<void>;
};

/** Half the machine at most, so music and the window never wait on a fit. */
export function fitThreads(): number {
  return Math.max(1, Math.min(MOST_THREADS, Math.floor(availableParallelism() / 2)));
}

function sharedFloat64(length: number): Float64Array {
  return new Float64Array(new SharedArrayBuffer(length * Float64Array.BYTES_PER_ELEMENT));
}

/** The library's features have to be on shared memory already: copying 30 MB a fit would cost what the threads save. */
function isShared(array: ArrayBufferView): boolean {
  return array.buffer instanceof SharedArrayBuffer;
}

export function createFitPool(workerPath: string, threads: number = fitThreads()): FitPool {
  let helpers: Worker[] = [];
  let queue: Promise<unknown> = Promise.resolve();
  let pending = 0;
  let idle: ReturnType<typeof setTimeout> | null = null;

  async function letGo(): Promise<void> {
    const leaving = helpers;
    helpers = [];
    await Promise.all(leaving.map((helper) => helper.terminate()));
  }

  function helpersNow(): Worker[] {
    if (idle !== null) clearTimeout(idle);
    idle = null;
    if (helpers.length === 0) helpers = Array.from({ length: threads }, () => new Worker(workerPath));
    return helpers;
  }

  async function run(library: StationLibrary, set: TrainingSet, control: Int32Array): Promise<StationWeights | null> {
    if (isCancelled(control)) return null;
    if (!isShared(library.features)) throw new Error('A fit needs the features on shared memory');
    const size = library.dimensions + 1;
    const rows = new Int32Array(new SharedArrayBuffer(set.rows.byteLength));
    rows.set(set.rows);
    const labels = sharedFloat64(set.labels.length);
    labels.set(set.labels);
    const weights = sharedFloat64(set.weights.length);
    weights.set(set.weights);
    const model = sharedFloat64(size);
    const shared = {
      features: library.features,
      dimensions: library.dimensions,
      rows,
      labels,
      weights,
      model,
      residuals: sharedFloat64(set.rows.length),
      gradient: sharedFloat64(size),
      moments: { first: sharedFloat64(size), second: sharedFloat64(size) },
      control,
    };

    const working = helpersNow();
    const listeners: (() => void)[] = [];
    try {
      await Promise.all(
        working.map(
          (helper, part) =>
            new Promise<void>((resolve, reject) => {
              const onDone = () => resolve();
              const onError = (error: unknown) => reject(error instanceof Error ? error : new Error(String(error)));
              const onExit = () => reject(new Error('A fit thread stopped'));
              helper.once('message', onDone);
              helper.once('error', onError);
              helper.once('exit', onExit);
              listeners.push(() => {
                helper.off('message', onDone);
                helper.off('error', onError);
                helper.off('exit', onExit);
              });
              helper.postMessage({ ...shared, part, parts: working.length } satisfies FitTask);
            }),
        ),
      );
    } catch (error) {
      // The others would wait at the barrier forever for the one that's gone.
      for (const remove of listeners) remove();
      await letGo();
      throw error;
    }
    for (const remove of listeners) remove();
    return isCancelled(control) ? null : Float64Array.from(model);
  }

  return {
    fit(library, set) {
      const control = new Int32Array(new SharedArrayBuffer(CONTROL_SLOTS * Int32Array.BYTES_PER_ELEMENT));
      pending += 1;
      const weights = queue.then(() => run(library, set, control));
      queue = weights
        .catch(() => undefined)
        .finally(() => {
          pending -= 1;
          if (pending > 0 || helpers.length === 0) return;
          idle = setTimeout(() => void letGo(), IDLE_MS);
          idle.unref();
        });
      return { weights, cancel: () => cancelFit(control) };
    },

    async stop() {
      if (idle !== null) clearTimeout(idle);
      idle = null;
      await letGo();
    },
  };
}
