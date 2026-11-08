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

export type StationWeights = { w: Float64Array; b: number };

type TrainingSet = { rows: Int32Array; labels: Float64Array; weights: Float64Array };

export function rowCount(library: StationLibrary): number {
  return library.dimensions === 0 ? 0 : library.features.length / library.dimensions;
}

/** Each dimension to mean 0 and spread 1 over the library, so the penalty weighs them alike. */
export function standardize(vectors: Float32Array, dimensions: number): Float32Array {
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
  const features = new Float32Array(vectors.length);
  for (let d = 0; d < dimensions; d++) spread[d] = Math.sqrt(spread[d] as number) || 1;
  for (let row = 0; row < rows; row++) {
    for (let d = 0; d < dimensions; d++) {
      const at = row * dimensions + d;
      features[at] = ((vectors[at] as number) - (mean[d] as number)) / (spread[d] as number);
    }
  }
  return features;
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
function trainingSet(examples: readonly StationExample[], of: Int32Array, hidden: number | null): TrainingSet {
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

/** Weighted L2 logistic regression, with the bias unpenalized, fitted as `STATION_TUNING.steps` says. */
function fit({ features, dimensions }: StationLibrary, set: TrainingSet): StationWeights {
  const w = new Float64Array(dimensions);
  let b = 0;
  const gradient = new Float64Array(dimensions + 1);
  const first = new Float64Array(dimensions + 1);
  const second = new Float64Array(dimensions + 1);
  for (let step = 1; step <= STATION_TUNING.steps; step++) {
    gradient.fill(0);
    for (let k = 0; k < set.rows.length; k++) {
      const offset = (set.rows[k] as number) * dimensions;
      let z = b;
      for (let d = 0; d < dimensions; d++) z += (w[d] as number) * (features[offset + d] as number);
      const residual = (set.weights[k] as number) * (1 / (1 + Math.exp(-z)) - (set.labels[k] as number));
      for (let d = 0; d < dimensions; d++)
        gradient[d] = (gradient[d] as number) + residual * (features[offset + d] as number);
      gradient[dimensions] = (gradient[dimensions] as number) + residual;
    }
    for (let d = 0; d < dimensions; d++)
      gradient[d] = (gradient[d] as number) + STATION_TUNING.lambda * (w[d] as number);
    const firstScale = 1 - ADAM_BETA1 ** step;
    const secondScale = 1 - ADAM_BETA2 ** step;
    for (let d = 0; d <= dimensions; d++) {
      const g = gradient[d] as number;
      first[d] = ADAM_BETA1 * (first[d] as number) + (1 - ADAM_BETA1) * g;
      second[d] = ADAM_BETA2 * (second[d] as number) + (1 - ADAM_BETA2) * g * g;
      const move =
        (STATION_TUNING.learningRate * ((first[d] as number) / firstScale)) /
        (Math.sqrt((second[d] as number) / secondScale) + ADAM_EPSILON);
      if (d < dimensions) w[d] = (w[d] as number) - move;
      else b -= move;
    }
  }
  return { w, b };
}

function scoresOf({ features, dimensions }: StationLibrary, { w, b }: StationWeights, rows: number): Float32Array {
  const scores = new Float32Array(rows);
  for (let row = 0; row < rows; row++) {
    let z = b;
    for (let d = 0; d < dimensions; d++) z += (w[d] as number) * (features[row * dimensions + d] as number);
    scores[row] = z;
  }
  return scores;
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

/** Null without a yes example to learn from. */
export function buildStation(
  library: StationLibrary,
  examples: readonly StationExample[],
  rules: StationRules,
): Station | null {
  if (!examples.some((example) => example.isYes && example.rows.length > 0)) return null;
  const rows = rowCount(library);
  const of = exampleOf(examples, rows);
  const scores = scoresOf(library, fit(library, trainingSet(examples, of, null)), rows);
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
): number[] {
  const of = exampleOf(examples, rowCount(library));
  const distance = (row: number) => Math.abs((station.scores[row] as number) - station.cut);
  const picked: number[] = [];
  const keys = new Set<string>();
  const candidates = unmarkedRows(of).filter((row) => passesGates(library, station.gates, row));
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
  const rows = rowCount(library);
  const of = exampleOf(examples, rows);
  const scores = scoresOf(library, fit(library, trainingSet(examples, of, index)), rows);
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
