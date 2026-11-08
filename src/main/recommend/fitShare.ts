/* What the fit's threads share: the task each is handed, how the work is divided, and the barrier they meet at. */

import type { FitMoments, StationWeights } from './stations';

/** Every array is on shared memory, so the threads all see one copy. */
export type FitTask = {
  part: number;
  parts: number;
  features: Float32Array;
  dimensions: number;
  rows: Int32Array;
  labels: Float64Array;
  weights: Float64Array;
  model: StationWeights;
  residuals: Float64Array;
  gradient: Float64Array;
  moments: FitMoments;
  control: Int32Array;
};

const ARRIVED = 0;
const GENERATION = 1;
const CANCEL = 2;
/** CANCEL as the last to arrive saw it, so every thread stops at the same barrier and none is left waiting. */
const STOPPED = 3;
export const CONTROL_SLOTS = 4;

/** `[from, to)` of `count` for part `part` of `parts`, as even as it divides. */
export function shareOf(count: number, part: number, parts: number): [number, number] {
  return [Math.floor((count * part) / parts), Math.floor((count * (part + 1)) / parts)];
}

/** Waits for all `parties`. False when the fit was cancelled, the same answer for every one of them. */
export function barrier(control: Int32Array, parties: number): boolean {
  const generation = Atomics.load(control, GENERATION);
  if (Atomics.add(control, ARRIVED, 1) === parties - 1) {
    Atomics.store(control, ARRIVED, 0);
    Atomics.store(control, STOPPED, Atomics.load(control, CANCEL));
    Atomics.add(control, GENERATION, 1);
    Atomics.notify(control, GENERATION);
  } else {
    while (Atomics.load(control, GENERATION) === generation) Atomics.wait(control, GENERATION, generation);
  }
  return Atomics.load(control, STOPPED) === 0;
}

export function cancelFit(control: Int32Array): void {
  Atomics.store(control, CANCEL, 1);
}

export function isCancelled(control: Int32Array): boolean {
  return Atomics.load(control, CANCEL) === 1;
}
