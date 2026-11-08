/*
 * A mood station from yes and no examples: a classifier on the stored vectors, gates taken from the yes examples, and a grade
 * from hiding each example in turn. Pure, and free of imports so the research scripts can run it as it is. What it rests on,
 * and what it can't hear, is in docs/research/stations.md.
 */

export const STATION_TUNING = {
  /** L2 strength on z-scored vectors. Set once, never tuned: with this few examples, tuning would only fit the test. */
  lambda: 0.01,
  /** A song marked by itself weighs this much of a whole album, artist or genre. */
  singleWeight: 0.2,
  /** A song is in when it ranks in this top share of the unmarked library, which is where hidden yes examples landed. */
  topShare: 0.1,
  /** The gates let the yes songs at the far ends fall outside: this share at each end. */
  gateTail: 0.05,
  /** A hidden example counts as found at this percentile of the unmarked library, as `topShare` says. */
  foundAt: 90,
  /**
   * Adam from zero, this many full-batch steps at this rate, is the fit the research measured. It stops well short of the
   * optimum, which holds the classifier back more than `lambda` alone. Run to the optimum, Study picked other songs (rank
   * correlation 0.52) and sorted the Korb no's and Planet Coaster worse, so a better optimizer would be a different method.
   */
  steps: 300,
  learningRate: 0.01,
} as const;

const ADAM_BETA1 = 0.9;
const ADAM_BETA2 = 0.999;
const ADAM_EPSILON = 1e-8;

export type StationExample = {
  isYes: boolean;
  /** Rows of the library's vectors. */
  rows: readonly number[];
  /** One song marked by itself, rather than an album, artist or genre. */
  isSingle: boolean;
};

export type StationRules = { instrumental: boolean; calm: boolean; littleSinging: boolean };

export type StationLibrary = {
  /** Z-scored per dimension, from `standardize`. */
  features: Float32Array;
  dimensions: number;
  /** By row, higher as more instrumental, or null without the voice model. */
  voice: Float32Array | null;
  /** By row, 0 to 1, or null without the energy models. */
  energy: Float32Array | null;
  /** By row, the share of the song that's sung, NaN when nobody knows. */
  sung: Float32Array | null;
};

export type StationGates = {
  instrumentalAtLeast: number | null;
  energyAtMost: number | null;
  sungAtMost: number | null;
};

export type Station = {
  /** By row. Only their order means anything. */
  scores: Float32Array;
  gates: StationGates;
  cut: number;
  /** What it plays, best first: what passed among the unmarked library, then every yes example. */
  rows: number[];
  /** How many of those weren't examples. */
  found: number;
};

export type HeldOut = {
  example: number;
  /** Median percentile of its songs among the unmarked library, 100 at the top. */
  median: number;
  isRight: boolean;
};

export type StationGrade =
  | { kind: 'too-few' | 'clear' | 'fuzzy'; heldOut: HeldOut[] }
  | { kind: 'alike'; heldOut: HeldOut[]; alike: { yes: number; no: number }[] };

/** One weight a dimension, then the bias. */
export type StationWeights = Float64Array;

/** What one fit learns from: rows of the library, each with its label (1 for yes) and weight. */
export type TrainingSet = { rows: Int32Array; labels: Float64Array; weights: Float64Array };

/** Adam's running averages, one of each a weight. */
export type FitMoments = { first: Float64Array; second: Float64Array };

export type Standardizing = { mean: Float64Array; spread: Float64Array };

export function rowCount(library: StationLibrary): number {
  return library.dimensions === 0 ? 0 : library.features.length / library.dimensions;
}

/** Each dimension's mean and spread over the library. A flat dimension gets a spread of 1. */
export function standardizing(vectors: Float32Array, dimensions: number): Standardizing {
  const rows = dimensions === 0 ? 0 : vectors.length / dimensions;
  const mean = new Float64Array(dimensions);
  const spread = new Float64Array(dimensions);
  for (let row = 0; row < rows; row++) {
    for (let d = 0; d < dimensions; d++)
      mean[d] = (mean[d] as number) + (vectors[row * dimensions + d] as number) / rows;
  }
  for (let row = 0; row < rows; row++) {
    for (let d = 0; d < dimensions; d++) {
      spread[d] = (spread[d] as number) + ((vectors[row * dimensions + d] as number) - (mean[d] as number)) ** 2 / rows;
    }
  }
  for (let d = 0; d < dimensions; d++) spread[d] = Math.sqrt(spread[d] as number) || 1;
  return { mean, spread };
}

/** Each dimension to mean 0 and spread 1 over the library, so the penalty weighs them alike. Into `into` when given. */
export function standardize(
  vectors: Float32Array,
  dimensions: number,
  { mean, spread }: Standardizing = standardizing(vectors, dimensions),
  into: Float32Array = new Float32Array(vectors.length),
): Float32Array {
  const rows = dimensions === 0 ? 0 : vectors.length / dimensions;
  for (let row = 0; row < rows; row++) {
    for (let d = 0; d < dimensions; d++) {
      const at = row * dimensions + d;
      into[at] = ((vectors[at] as number) - (mean[d] as number)) / (spread[d] as number);
    }
  }
  return into;
}

/** The value at a share of the way through, taken as the research scripts take it. */
function quantile(values: readonly number[], share: number): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] as number;
}

/** Which example each row belongs to, the first that names it, or -1. */
function exampleOf(examples: readonly StationExample[], rows: number): Int32Array {
  const of = new Int32Array(rows).fill(-1);
  examples.forEach((example, index) => {
    for (const row of example.rows) if ((of[row] as number) === -1) of[row] = index;
  });
  return of;
}

function unmarkedRows(of: Int32Array): number[] {
  const rows: number[] = [];
  for (let row = 0; row < of.length; row++) if ((of[row] as number) === -1) rows.push(row);
  return rows;
}

/** Every yes example weighs alike in total, as does every no, and the unmarked library is one block of the same weight. */
export function trainingSet(
  library: StationLibrary,
  examples: readonly StationExample[],
  hidden: number | null,
): TrainingSet {
  const of = exampleOf(examples, rowCount(library));
  const weightOf = (example: StationExample) => (example.isSingle ? STATION_TUNING.singleWeight : 1);
  const kept = examples.filter((example, index) => index !== hidden && example.rows.length > 0);
  const yesTotal = kept.filter((e) => e.isYes).reduce((sum, e) => sum + weightOf(e), 0);
  const noTotal = kept.filter((e) => !e.isYes).reduce((sum, e) => sum + weightOf(e), 0);
  const rows: number[] = [];
  const labels: number[] = [];
  const weights: number[] = [];
  examples.forEach((example, index) => {
    if (index === hidden) return;
    const total = example.isYes ? yesTotal : noTotal;
    for (const row of example.rows) {
      if ((of[row] as number) !== index) continue;
      rows.push(row);
      labels.push(example.isYes ? 1 : 0);
      weights.push(weightOf(example) / total / example.rows.length);
    }
  });
  const unmarked = unmarkedRows(of);
  for (const row of unmarked) {
    rows.push(row);
    labels.push(0);
    weights.push(1 / unmarked.length);
  }
  return { rows: Int32Array.from(rows), labels: Float64Array.from(labels), weights: Float64Array.from(weights) };
}

/*
 * A step of the fit is three passes, each split by range so threads can share them: residuals by training row, then the
 * gradient and Adam's update by weight. Each sum runs in the same order however the work is split, so a split fit comes
 * out exactly as a whole one.
 */

function residual(set: TrainingSet, k: number, z: number): number {
  return (set.weights[k] as number) * (1 / (1 + Math.exp(-z)) - (set.labels[k] as number));
}

/*
 * Both passes take four rows at a time. Each sum still adds in the same order, so nothing changes but speed: a row's sum is
 * one long chain of additions, and four chains side by side keep the processor busy while each waits on its last add.
 */

/** Weight × (σ(z) − label), for training rows `from` to `to`. */
export function residualsOf(
  { features, dimensions }: StationLibrary,
  set: TrainingSet,
  weights: StationWeights,
  from: number,
  to: number,
  into: Float64Array,
): void {
  const bias = weights[dimensions] as number;
  let k = from;
  for (; k + 3 < to; k += 4) {
    const o0 = (set.rows[k] as number) * dimensions;
    const o1 = (set.rows[k + 1] as number) * dimensions;
    const o2 = (set.rows[k + 2] as number) * dimensions;
    const o3 = (set.rows[k + 3] as number) * dimensions;
    let z0 = bias;
    let z1 = bias;
    let z2 = bias;
    let z3 = bias;
    for (let d = 0; d < dimensions; d++) {
      const w = weights[d] as number;
      z0 += w * (features[o0 + d] as number);
      z1 += w * (features[o1 + d] as number);
      z2 += w * (features[o2 + d] as number);
      z3 += w * (features[o3 + d] as number);
    }
    into[k] = residual(set, k, z0);
    into[k + 1] = residual(set, k + 1, z1);
    into[k + 2] = residual(set, k + 2, z2);
    into[k + 3] = residual(set, k + 3, z3);
  }
  for (; k < to; k++) {
    const offset = (set.rows[k] as number) * dimensions;
    let z = bias;
    for (let d = 0; d < dimensions; d++) z += (weights[d] as number) * (features[offset + d] as number);
    into[k] = residual(set, k, z);
  }
}

/** The gradient for weights `from` to `to`. Index `dimensions` is the bias, which has no penalty. */
export function gradientOf(
  { features, dimensions }: StationLibrary,
  set: TrainingSet,
  residuals: Float64Array,
  weights: StationWeights,
  from: number,
  to: number,
  into: Float64Array,
): void {
  const end = Math.min(to, dimensions);
  const hasBias = to > dimensions;
  const count = set.rows.length;
  into.fill(0, from, to);
  let k = 0;
  for (; k + 3 < count; k += 4) {
    const r0 = residuals[k] as number;
    const r1 = residuals[k + 1] as number;
    const r2 = residuals[k + 2] as number;
    const r3 = residuals[k + 3] as number;
    const o0 = (set.rows[k] as number) * dimensions;
    const o1 = (set.rows[k + 1] as number) * dimensions;
    const o2 = (set.rows[k + 2] as number) * dimensions;
    const o3 = (set.rows[k + 3] as number) * dimensions;
    // Left to right, so row k is added before row k + 1, as one row at a time would.
    for (let d = from; d < end; d++) {
      into[d] =
        (into[d] as number) +
        r0 * (features[o0 + d] as number) +
        r1 * (features[o1 + d] as number) +
        r2 * (features[o2 + d] as number) +
        r3 * (features[o3 + d] as number);
    }
    if (hasBias) into[dimensions] = (into[dimensions] as number) + r0 + r1 + r2 + r3;
  }
  for (; k < count; k++) {
    const r = residuals[k] as number;
    const offset = (set.rows[k] as number) * dimensions;
    for (let d = from; d < end; d++) into[d] = (into[d] as number) + r * (features[offset + d] as number);
    if (hasBias) into[dimensions] = (into[dimensions] as number) + r;
  }
  for (let d = from; d < end; d++) into[d] = (into[d] as number) + STATION_TUNING.lambda * (weights[d] as number);
}

/** Adam's update for weights `from` to `to`. `step` counts from 1. */
export function adamStep(
  weights: StationWeights,
  gradient: Float64Array,
  { first, second }: FitMoments,
  step: number,
  from: number,
  to: number,
): void {
  const firstScale = 1 - ADAM_BETA1 ** step;
  const secondScale = 1 - ADAM_BETA2 ** step;
  for (let d = from; d < to; d++) {
    const g = gradient[d] as number;
    first[d] = ADAM_BETA1 * (first[d] as number) + (1 - ADAM_BETA1) * g;
    second[d] = ADAM_BETA2 * (second[d] as number) + (1 - ADAM_BETA2) * g * g;
    weights[d] =
      (weights[d] as number) -
      (STATION_TUNING.learningRate * ((first[d] as number) / firstScale)) /
        (Math.sqrt((second[d] as number) / secondScale) + ADAM_EPSILON);
  }
}

/** Weighted L2 logistic regression, fitted as `STATION_TUNING.steps` says, all on this thread. */
export function fitStation(library: StationLibrary, set: TrainingSet): StationWeights {
  const size = library.dimensions + 1;
  const weights = new Float64Array(size);
  const residuals = new Float64Array(set.rows.length);
  const gradient = new Float64Array(size);
  const moments = { first: new Float64Array(size), second: new Float64Array(size) };
  for (let step = 1; step <= STATION_TUNING.steps; step++) {
    residualsOf(library, set, weights, 0, set.rows.length, residuals);
    gradientOf(library, set, residuals, weights, 0, size, gradient);
    adamStep(weights, gradient, moments, step, 0, size);
  }
  return weights;
}

/** By row of the library. Only their order means anything. */
export function scoresOf({ features, dimensions }: StationLibrary, weights: StationWeights): Float32Array {
  const rows = dimensions === 0 ? 0 : features.length / dimensions;
  const scores = new Float32Array(rows);
  for (let row = 0; row < rows; row++) {
    let z = weights[dimensions] as number;
    for (let d = 0; d < dimensions; d++) z += (weights[d] as number) * (features[row * dimensions + d] as number);
    scores[row] = z;
  }
  return scores;
}

/** The same model, for vectors as they're stored: it goes on scoring a song the same way as the library around it changes. */
export function unstandardized(weights: StationWeights, { mean, spread }: Standardizing): StationWeights {
  const dimensions = weights.length - 1;
  const raw = new Float64Array(weights.length);
  let bias = weights[dimensions] as number;
  for (let d = 0; d < dimensions; d++) {
    raw[d] = (weights[d] as number) / (spread[d] as number);
    bias -= (raw[d] as number) * (mean[d] as number);
  }
  raw[dimensions] = bias;
  return raw;
}

/** `scoresOf` for weights from `unstandardized`. */
export function rawScoresOf(vectors: Float32Array, dimensions: number, weights: StationWeights): Float32Array {
  return scoresOf({ features: vectors, dimensions, voice: null, energy: null, sung: null }, weights);
}

/** From the yes examples, so a station keeps to what they have in common. A song marked yes by itself is never shut out. */
export function stationGates(
  { voice, energy, sung }: StationLibrary,
  examples: readonly StationExample[],
  rules: StationRules,
): StationGates {
  const yes = examples.filter((example) => example.isYes);
  const all = yes.flatMap((example) => example.rows);
  const singles = yes.filter((example) => example.isSingle).flatMap((example) => example.rows);
  const valuesOf = (by: Float32Array, rows: readonly number[]) =>
    rows.map((row) => by[row] as number).filter((value) => !Number.isNaN(value));

  let instrumentalAtLeast: number | null = null;
  if (rules.instrumental && voice !== null) {
    const low = quantile(valuesOf(voice, all), STATION_TUNING.gateTail);
    instrumentalAtLeast = low === null ? null : Math.min(low, ...valuesOf(voice, singles));
  }
  let energyAtMost: number | null = null;
  if (rules.calm && energy !== null) {
    const high = quantile(valuesOf(energy, all), 1 - STATION_TUNING.gateTail);
    energyAtMost = high === null ? null : Math.max(high, ...valuesOf(energy, singles));
  }
  let sungAtMost: number | null = null;
  if (rules.littleSinging && sung !== null) {
    const high = quantile(valuesOf(sung, all), 1 - STATION_TUNING.gateTail);
    sungAtMost = high === null ? null : Math.max(high, ...valuesOf(sung, singles));
  }
  return { instrumentalAtLeast, energyAtMost, sungAtMost };
}

export function passesGates(library: StationLibrary, gates: StationGates, row: number): boolean {
  const { voice, energy, sung } = library;
  if (gates.instrumentalAtLeast !== null && voice !== null && (voice[row] as number) < gates.instrumentalAtLeast)
    return false;
  if (gates.energyAtMost !== null && energy !== null && (energy[row] as number) > gates.energyAtMost) return false;
  // Unknown isn't no: a song nobody has lyrics for passes.
  const share = sung?.[row] ?? Number.NaN;
  return gates.sungAtMost === null || Number.isNaN(share) || share <= gates.sungAtMost;
}

/** Whether there's a yes example with songs in the library to learn from. */
export function canBuild(examples: readonly StationExample[]): boolean {
  return examples.some((example) => example.isYes && example.rows.length > 0);
}

/** Null without a yes example to learn from. */
export function buildStation(
  library: StationLibrary,
  examples: readonly StationExample[],
  rules: StationRules,
): Station | null {
  if (!canBuild(examples)) return null;
  return stationFrom(
    library,
    examples,
    rules,
    scoresOf(library, fitStation(library, trainingSet(library, examples, null))),
  );
}

/** The station, given scores from a fit on all its examples. */
export function stationFrom(
  library: StationLibrary,
  examples: readonly StationExample[],
  rules: StationRules,
  scores: Float32Array,
): Station {
  const of = exampleOf(examples, rowCount(library));
  const gates = stationGates(library, examples, rules);

  const unmarked = unmarkedRows(of);
  const cut =
    quantile(
      unmarked.map((row) => scores[row] as number),
      1 - STATION_TUNING.topShare,
    ) ?? Infinity;
  const passed = unmarked
    .filter((row) => (scores[row] as number) >= cut && passesGates(library, gates, row))
    .toSorted((a, b) => (scores[b] as number) - (scores[a] as number));
  // A song named by a no example as well as a yes one is whichever names it first.
  const yesRows = [...new Set(examples.filter((example) => example.isYes).flatMap((example) => example.rows))].filter(
    (row) => examples[of[row] as number]?.isYes === true,
  );
  return { scores, gates, cut, rows: [...passed, ...yesRows], found: passed.length };
}

/**
 * What to ask about next: unmarked songs that pass the gates, closest to the cut on either side, one for each key (an album,
 * say) so a round isn't one record.
 */
export function leastSure(
  library: StationLibrary,
  examples: readonly StationExample[],
  station: Station,
  keyOf: (row: number) => string,
  limit: number,
  isAskable: (row: number) => boolean = () => true,
): number[] {
  const of = exampleOf(examples, rowCount(library));
  const distance = (row: number) => Math.abs((station.scores[row] as number) - station.cut);
  const picked: number[] = [];
  const keys = new Set<string>();
  const candidates = unmarkedRows(of).filter((row) => isAskable(row) && passesGates(library, station.gates, row));
  for (const row of candidates.toSorted((a, b) => distance(a) - distance(b))) {
    const key = keyOf(row);
    if (keys.has(key)) continue;
    keys.add(key);
    picked.push(row);
    if (picked.length >= limit) break;
  }
  return picked;
}

function percentileAmong(sortedUnmarked: Float32Array, score: number): number {
  let low = 0;
  let high = sortedUnmarked.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((sortedUnmarked[middle] as number) < score) low = middle + 1;
    else high = middle;
  }
  return sortedUnmarked.length === 0 ? 0 : (100 * low) / sortedUnmarked.length;
}

function centroid({ features, dimensions }: StationLibrary, rows: readonly number[]): Float64Array {
  const sum = new Float64Array(dimensions);
  for (const row of rows) {
    for (let d = 0; d < dimensions; d++)
      sum[d] = (sum[d] as number) + (features[row * dimensions + d] as number) / rows.length;
  }
  return sum;
}

function cosine(a: Float64Array, b: Float64Array): number {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += (a[i] as number) * (b[i] as number);
    aa += (a[i] as number) ** 2;
    bb += (b[i] as number) ** 2;
  }
  return ab / (Math.sqrt(aa * bb) || 1);
}

/** Where one example's songs land among the unmarked library, fitted without it. */
export function holdOut(library: StationLibrary, examples: readonly StationExample[], index: number): HeldOut {
  const scores = scoresOf(library, fitStation(library, trainingSet(library, examples, index)));
  return heldOutFrom(library, examples, index, scores);
}

/** `holdOut`, given scores from a fit without example `index`. */
export function heldOutFrom(
  library: StationLibrary,
  examples: readonly StationExample[],
  index: number,
  scores: Float32Array,
): HeldOut {
  const of = exampleOf(examples, rowCount(library));
  const sorted = Float32Array.from(unmarkedRows(of), (row) => scores[row] as number).sort();
  const own = (examples[index]?.rows ?? []).filter((row) => (of[row] as number) === index);
  const percentiles = own.map((row) => percentileAmong(sorted, scores[row] as number)).toSorted((a, b) => a - b);
  const median = percentiles[Math.floor(percentiles.length / 2)] ?? 0;
  const isFound = median >= STATION_TUNING.foundAt;
  return { example: index, median, isRight: examples[index]?.isYes === true ? isFound : !isFound };
}

/** The album, artist and genre examples, which are what grading hides one at a time. Single songs are too small to judge. */
export function gradedExamples(examples: readonly StationExample[]): number[] {
  return examples.flatMap((example, index) => (!example.isSingle && example.rows.length > 0 ? [index] : []));
}

/**
 * Clear when every hidden yes lands in the top share and no hidden no does. A yes that sinks and a no that stays up are said
 * to sound alike, the no nearest the yes. Too few without two album, artist or genre yes examples to hide in turn.
 */
export function gradeStation(
  library: StationLibrary,
  examples: readonly StationExample[],
  heldOut: readonly HeldOut[],
): StationGrade {
  const list = [...heldOut];
  const isYes = (held: HeldOut) => examples[held.example]?.isYes === true;
  if (list.filter(isYes).length < 2) return { kind: 'too-few', heldOut: list };
  if (list.every(({ isRight }) => isRight)) return { kind: 'clear', heldOut: list };

  const centerOf = (held: HeldOut) => centroid(library, examples[held.example]?.rows ?? []);
  const wrongNo = list
    .filter((held) => !held.isRight && !isYes(held))
    .map((held) => ({ held, center: centerOf(held) }));
  const alike = list
    .filter((held) => !held.isRight && isYes(held))
    .flatMap((held) => {
      const center = centerOf(held);
      const nearest = wrongNo.toSorted((a, b) => cosine(center, b.center) - cosine(center, a.center))[0];
      return nearest === undefined ? [] : [{ yes: held.example, no: nearest.held.example }];
    });
  return alike.length > 0 ? { kind: 'alike', heldOut: list, alike } : { kind: 'fuzzy', heldOut: list };
}
