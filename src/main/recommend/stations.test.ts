import { describe, expect, it } from 'vitest';
import {
  buildStation,
  gradeStation,
  gradedExamples,
  holdOut,
  leastSure,
  passesGates,
  standardize,
  stationGates,
  type StationExample,
  type StationLibrary,
  type StationRules,
} from './stations';

const D = 8;
const NO_RULES: StationRules = { instrumental: false, calm: false, littleSinging: false };
const ALL_RULES: StationRules = { instrumental: true, calm: true, littleSinging: true };

/** Deterministic, so a failure can be run again. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(next: () => number): number {
  return Math.sqrt(-2 * Math.log(next() || 1e-12)) * Math.cos(2 * Math.PI * next());
}

type Cluster = { count: number; center: Partial<Record<number, number>> };

/** Rows in order: each cluster's in turn. Returns the vectors and each cluster's rows. */
function makeVectors(clusters: readonly Cluster[], seed = 1): { vectors: Float32Array; rowsOf: number[][] } {
  const next = random(seed);
  const total = clusters.reduce((sum, { count }) => sum + count, 0);
  const vectors = new Float32Array(total * D);
  const rowsOf: number[][] = [];
  let row = 0;
  for (const { count, center } of clusters) {
    const rows: number[] = [];
    for (let i = 0; i < count; i++) {
      for (let d = 0; d < D; d++) vectors[row * D + d] = (center[d] ?? 0) + gaussian(next);
      rows.push(row);
      row += 1;
    }
    rowsOf.push(rows);
  }
  return { vectors, rowsOf };
}

function libraryOf(vectors: Float32Array, extra: Partial<StationLibrary> = {}): StationLibrary {
  return { features: standardize(vectors, D), dimensions: D, voice: null, energy: null, sung: null, ...extra };
}

const yes = (rows: readonly number[], isSingle = false): StationExample => ({ isYes: true, rows, isSingle });
const no = (rows: readonly number[], isSingle = false): StationExample => ({ isYes: false, rows, isSingle });

/** Background, then two yes albums around one place, two no albums around another, and room for more. */
function separable(more: readonly Cluster[] = []) {
  return makeVectors([
    { count: 400, center: {} },
    { count: 20, center: { 0: 3 } },
    { count: 20, center: { 0: 3, 3: 0.5 } },
    { count: 20, center: { 1: 3 } },
    { count: 20, center: { 1: 3, 4: 0.5 } },
    ...more,
  ]);
}

describe('standardize', () => {
  it('gives each dimension mean 0 and spread 1, and a flat one zeros', () => {
    const vectors = Float32Array.from([1, 5, 3, 5, 5, 5]);
    const features = standardize(vectors, 2);
    expect([...features].map((x) => +x.toFixed(4))).toEqual([-1.2247, 0, 0, 0, 1.2247, 0]);
  });
});

describe('buildStation', () => {
  it('needs a yes example to learn from', () => {
    const { vectors, rowsOf } = separable();
    expect(buildStation(libraryOf(vectors), [no(rowsOf[3] ?? [])], NO_RULES)).toBeNull();
    expect(buildStation(libraryOf(vectors), [yes([])], NO_RULES)).toBeNull();
  });

  it('plays the top tenth of the unmarked library, best first, then every yes example and never a no one', () => {
    const { vectors, rowsOf } = separable([{ count: 30, center: { 0: 3, 5: 0.3 } }]);
    const [, yesA = [], yesB = [], noA = [], noB = [], alsoYes = []] = rowsOf;
    const examples = [yes(yesA), yes(yesB), no(noA), no(noB)];
    const station = buildStation(libraryOf(vectors), examples, NO_RULES);
    if (station === null) throw new Error('no station');

    const unmarked = 400 + 30;
    expect(station.found).toBeLessThanOrEqual(Math.ceil(unmarked * 0.1));
    const passed = station.rows.slice(0, station.found);
    expect(passed).toEqual(passed.toSorted((a, b) => (station.scores[b] as number) - (station.scores[a] as number)));
    expect(station.rows.slice(station.found)).toEqual([...yesA, ...yesB]);
    expect(station.rows.some((row) => noA.includes(row) || noB.includes(row))).toBe(false);
    // The unmarked songs that sound like the yes albums are what it finds.
    expect(alsoYes.filter((row) => passed.includes(row)).length).toBeGreaterThanOrEqual(25);
  });

  it('counts a song named by a yes and a no example as whichever names it first', () => {
    const { vectors, rowsOf } = separable();
    const [, yesA = [], yesB = [], noA = []] = rowsOf;
    const shared = yesA[0] as number;
    const station = buildStation(libraryOf(vectors), [no([shared], true), yes(yesA), yes(yesB), no(noA)], NO_RULES);
    expect(station?.rows.includes(shared)).toBe(false);
  });

  it('lets a yes example in whatever the gates say', () => {
    const { vectors, rowsOf } = separable();
    const [, yesA = [], yesB = []] = rowsOf;
    const voice = new Float32Array(vectors.length / D).fill(0.9);
    voice[yesA[0] as number] = 0;
    const station = buildStation(libraryOf(vectors, { voice }), [yes(yesA), yes(yesB)], ALL_RULES);
    expect(station?.rows.includes(yesA[0] as number)).toBe(true);
  });
});

describe('stationGates', () => {
  const rows = Array.from({ length: 20 }, (_, i) => i);

  it('keeps to what nearly every yes song has: the 5th percentile of instrumental, the 95th of energy and singing', () => {
    const library = libraryOf(new Float32Array(30 * D), {
      voice: Float32Array.from({ length: 30 }, (_, i) => i / 20),
      energy: Float32Array.from({ length: 30 }, (_, i) => i / 20),
      sung: Float32Array.from({ length: 30 }, (_, i) => i / 20),
    });
    const gates = stationGates(library, [yes(rows)], ALL_RULES);
    expect(gates.instrumentalAtLeast).toBeCloseTo(0.05);
    expect(gates.energyAtMost).toBeCloseTo(0.95);
    expect(gates.sungAtMost).toBeCloseTo(0.95);
  });

  it('never shuts out a song marked yes by itself', () => {
    const voice = Float32Array.from({ length: 30 }, (_, i) => 0.5 + i / 100);
    voice[25] = 0.1;
    const library = libraryOf(new Float32Array(30 * D), { voice });
    const gates = stationGates(library, [yes(rows), yes([25], true)], ALL_RULES);
    expect(gates.instrumentalAtLeast).toBeCloseTo(0.1);
    expect(passesGates(library, gates, 25)).toBe(true);
  });

  it('has no gate for a rule that is off, a model that is missing, or singing nobody knows', () => {
    const library = libraryOf(new Float32Array(30 * D), {
      voice: new Float32Array(30).fill(0.9),
      sung: new Float32Array(30).fill(Number.NaN),
    });
    expect(stationGates(library, [yes(rows)], { instrumental: false, calm: true, littleSinging: true })).toEqual({
      instrumentalAtLeast: null,
      energyAtMost: null,
      sungAtMost: null,
    });
  });

  it('lets through a song whose singing is unknown', () => {
    const sung = Float32Array.from({ length: 30 }, (_, i) => (i < 20 ? 0.1 : 0.8));
    sung[22] = Number.NaN;
    const library = libraryOf(new Float32Array(30 * D), { sung });
    const gates = stationGates(library, [yes(rows)], ALL_RULES);
    expect(passesGates(library, gates, 21)).toBe(false);
    expect(passesGates(library, gates, 22)).toBe(true);
  });
});

describe('leastSure', () => {
  it('asks about unmarked songs that pass the gates, nearest the cut first, one for each key', () => {
    const { vectors, rowsOf } = separable();
    const [, yesA = [], yesB = [], noA = [], noB = []] = rowsOf;
    const voice = new Float32Array(vectors.length / D).fill(0.9);
    voice[3] = 0;
    const library = libraryOf(vectors, { voice });
    const examples = [yes(yesA), yes(yesB), no(noA), no(noB)];
    const station = buildStation(library, examples, ALL_RULES);
    if (station === null) throw new Error('no station');

    const asked = leastSure(library, examples, station, (row) => String(row % 50), 6);
    expect(asked).toHaveLength(6);
    expect(new Set(asked.map((row) => row % 50)).size).toBe(6);
    expect(asked.some((row) => [...yesA, ...yesB, ...noA, ...noB, 3].includes(row))).toBe(false);
    const distance = (row: number) => Math.abs((station.scores[row] as number) - station.cut);
    expect(asked.map(distance)).toEqual(asked.map(distance).toSorted((a, b) => a - b));
  });
});

describe('grading', () => {
  it('is clear when each hidden yes album is found again and each hidden no album isn’t', () => {
    const { vectors, rowsOf } = separable();
    const [, yesA = [], yesB = [], noA = [], noB = []] = rowsOf;
    const library = libraryOf(vectors);
    const examples = [yes(yesA), yes(yesB), no(noA), no(noB), yes([5], true)];
    expect(gradedExamples(examples)).toEqual([0, 1, 2, 3]);
    const heldOut = gradedExamples(examples).map((index) => holdOut(library, examples, index));
    expect(heldOut.map(({ isRight }) => isRight)).toEqual([true, true, true, true]);
    expect(heldOut[0]?.median).toBeGreaterThanOrEqual(90);
    expect(gradeStation(library, examples, heldOut).kind).toBe('clear');
  });

  it('says which yes and no sound alike when one sinks and the other stays up', () => {
    const { vectors, rowsOf } = separable([
      { count: 20, center: { 2: 3 } },
      { count: 20, center: { 2: 3 } },
    ]);
    const [, yesA = [], yesB = [], noA = [], noB = [], alikeYes = [], alikeNo = []] = rowsOf;
    const library = libraryOf(vectors);
    const examples = [yes(yesA), yes(yesB), no(noA), no(noB), yes(alikeYes), no(alikeNo)];
    const heldOut = gradedExamples(examples).map((index) => holdOut(library, examples, index));
    const grade = gradeStation(library, examples, heldOut);
    expect(grade).toMatchObject({ kind: 'alike', alike: [{ yes: 4, no: 5 }] });
  });

  it('needs two album, artist or genre yes examples to grade', () => {
    const { vectors, rowsOf } = separable();
    const [, yesA = [], , noA = []] = rowsOf;
    const library = libraryOf(vectors);
    const examples = [yes(yesA), no(noA), yes([3], true)];
    const heldOut = gradedExamples(examples).map((index) => holdOut(library, examples, index));
    expect(gradeStation(library, examples, heldOut).kind).toBe('too-few');
  });
});
