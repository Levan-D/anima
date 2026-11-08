/* In real threads, bundled the way electron-vite bundles the worker, since Vitest can't load `?modulePath`. */
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TEST_ROOT } from '@main/library/testFixtures';
import { createFitPool, type FitPool } from './fitPool';
import { fitStation, standardize, trainingSet, type StationExample, type StationLibrary } from './stations';

const BUNDLE = join(TEST_ROOT, 'fit-worker-bundle');
const WORKER = join(BUNDLE, 'fit.worker.js');
const D = 16;
const ROWS = 500;

let pool: FitPool | null = null;

beforeAll(async () => {
  await build({
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: { '@main': resolve('src/main'), '@shared': resolve('src/shared') } },
    build: {
      ssr: resolve('src/main/recommend/fit.worker.ts'),
      outDir: BUNDLE,
      emptyOutDir: true,
      rolldownOptions: { output: { entryFileNames: 'fit.worker.js' } },
    },
  });
}, 60_000);

afterEach(async () => {
  await pool?.stop();
  pool = null;
});

/** Rows 0–29 lean one way and 30–59 another, over a spread of the rest. Deterministic. */
function library(): StationLibrary {
  let state = 7;
  const next = () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 4294967296 - 0.5;
  };
  const vectors = Float32Array.from({ length: ROWS * D }, (_, at) => {
    const row = Math.floor(at / D);
    const lean = (row < 30 && at % D === 0) || (row >= 30 && row < 60 && at % D === 1) ? 2 : 0;
    return next() + lean;
  });
  const features = new Float32Array(new SharedArrayBuffer(vectors.byteLength));
  standardize(vectors, D, undefined, features);
  return { features, dimensions: D, voice: null, energy: null, sung: null };
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);
const EXAMPLES: StationExample[] = [
  { isYes: true, rows: range(0, 15), isSingle: false },
  { isYes: true, rows: range(15, 30), isSingle: false },
  { isYes: false, rows: range(30, 60), isSingle: false },
  { isYes: true, rows: [100], isSingle: true },
];

describe('the fit pool', () => {
  it.each([1, 3, 5])('comes out exactly as the fit on one thread does, across %i threads', async (threads) => {
    const lib = library();
    const set = trainingSet(lib, EXAMPLES, null);
    pool = createFitPool(WORKER, threads);
    const split = await pool.fit(lib, set).weights;
    expect(split).toEqual(fitStation(lib, set));
  });

  it('runs fits one after another, a hidden example and all', async () => {
    const lib = library();
    const running = createFitPool(WORKER, 2);
    pool = running;
    const sets = [null, 0, 2].map((hidden) => trainingSet(lib, EXAMPLES, hidden));
    const fits = await Promise.all(sets.map((set) => running.fit(lib, set).weights));
    expect(fits).toEqual(sets.map((set) => fitStation(lib, set)));
  });

  it('gives null for a cancelled fit, and fits again after it', async () => {
    const lib = library();
    const set = trainingSet(lib, EXAMPLES, null);
    pool = createFitPool(WORKER, 3);
    const first = pool.fit(lib, set);
    const queued = pool.fit(lib, set);
    queued.cancel();
    first.cancel();
    expect(await first.weights).toBeNull();
    expect(await queued.weights).toBeNull();
    expect(await pool.fit(lib, set).weights).toEqual(fitStation(lib, set));
  });
});
