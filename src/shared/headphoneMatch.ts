/*
 * Biquads fitted to a correction curve, scored with the app's own curveDb. The shape, the bounds, the starting point and the loss
 * are AutoEq's peq.py at AUTOEQ_COMMIT, MIT, (c) Jaakko Pasanen: THIRD_PARTY_NOTICES.md. The minimizer is ours, since SciPy's
 * SLSQP isn't here: damped least squares within the bounds. Reasons and measurements: docs/research/headphone-eq.md. Pure.
 */

import { EQ_MAX_GAIN_DB, EQ_MAX_Q, EQ_MIN_Q, type EqBand } from '@shared/domain';
import { CURVE_SAMPLE_RATE, curveDb } from '@shared/eqCurve';
import { MATCH_DEFAULTS, type FrCurve, type MatchSettings } from '@shared/headphone';
import {
  boostCapDb,
  correctionCurve,
  findPeaks,
  heldValueAt,
  LOW_END_TOP_HZ,
  matchGrid,
} from '@shared/headphoneCorrection';
import { measuredLine, targetLine } from '@shared/headphoneCurve';

const FIT_STEP = 1.02;
const SHELF_LOW_HZ = 105;
const SHELF_HIGH_HZ = 10_000;
const SHELF_Q = 0.7;
const PEAK_LOW_HZ = 20;
const PEAK_HIGH_HZ = 10_000;
const PEAK_MIN_Q = Math.max(0.18248, EQ_MIN_Q);
const PEAK_MAX_Q = Math.min(6, EQ_MAX_Q);
// Above here only the total matters, so a filter gets nothing for following the shape.
const AVERAGED_ABOVE_HZ = 10_000;
const SHARPNESS_STEEPNESS = 100;
// Enough that going over a listener's limit always costs more than missing the curve.
const OVER_LIMIT_WEIGHT = 30;
// A small price on gain, so spare peaks settle at nothing rather than as a boost and a cut fighting over the same spot.
const GAIN_COST = 0.01;
const MOST_STEPS = 200;
const SMALLEST_GAIN_RATIO = 1e-5;

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

type Problem = {
  hz: readonly number[];
  aim: readonly number[];
  /** Where the averaging above 10 kHz starts. */
  averagedFrom: number;
  /** The most boost at each point. */
  limits: readonly number[];
};

const responseOf = (band: EqBand, hz: readonly number[]) => hz.map((at) => curveDb([band], at, CURVE_SAMPLE_RATE));

/** AutoEq's: from nothing up to full over a narrow range around 18 dB per octave, and only on a boost. */
function sharpnessPenalty(band: EqBand, response: readonly number[]): number {
  if (band.kind !== 'peak') return 0;
  const gainLimit = -0.09503189270199464 + 20.575128011847003 / band.q;
  const share = 1 / (1 + Math.exp(-(band.gainDb / gainLimit - 1) * SHARPNESS_STEEPNESS));
  let sum = 0;
  for (const value of response) sum += (value * share) ** 2;
  return sum / response.length;
}

/** What's squared and summed: the loss in AutoEq's terms, plus what going over a limit costs. */
function residuals(problem: Problem, bands: readonly EqBand[], responses: readonly (readonly number[])[]): number[] {
  const { hz, aim, averagedFrom, limits } = problem;
  const count = hz.length;
  const total = hz.map((_, point) => responses.reduce((sum, response) => sum + (response[point] ?? 0), 0));
  const scale = 1 / Math.sqrt(count);
  const out: number[] = [];
  for (let point = 0; point < averagedFrom; point++) out.push(((aim[point] ?? 0) - (total[point] ?? 0)) * scale);
  let aimSum = 0;
  let totalSum = 0;
  for (let point = averagedFrom; point < count; point++) {
    aimSum += aim[point] ?? 0;
    totalSum += total[point] ?? 0;
  }
  const averaged = count - averagedFrom;
  out.push(averaged === 0 ? 0 : ((aimSum - totalSum) / averaged) * Math.sqrt(averaged) * scale);
  for (const [index, band] of bands.entries()) {
    out.push(Math.sqrt(sharpnessPenalty(band, responses[index] ?? [])));
    if (band.kind === 'peak') out.push(band.gainDb * GAIN_COST);
  }
  for (let point = 0; point < count; point++) {
    out.push(Math.max(0, (total[point] ?? 0) - (limits[point] ?? 0)) * OVER_LIMIT_WEIGHT * scale);
  }
  return out;
}

const costOf = (values: readonly number[]) => values.reduce((sum, value) => sum + value * value, 0);

type Slot = { band: number; field: 'logHz' | 'q' | 'gainDb'; low: number; high: number };

function slotsOf(bands: readonly EqBand[]): Slot[] {
  return bands.flatMap((band, index): Slot[] => {
    const gain: Slot = { band: index, field: 'gainDb', low: -EQ_MAX_GAIN_DB, high: EQ_MAX_GAIN_DB };
    if (band.kind !== 'peak') return [gain];
    return [
      { band: index, field: 'logHz', low: Math.log10(PEAK_LOW_HZ), high: Math.log10(PEAK_HIGH_HZ) },
      { band: index, field: 'q', low: PEAK_MIN_Q, high: PEAK_MAX_Q },
      gain,
    ];
  });
}

function readSlot(band: EqBand, field: Slot['field']): number {
  if (field === 'logHz') return Math.log10(band.frequencyHz);
  return field === 'q' ? band.q : band.gainDb;
}

function withSlot(band: EqBand, field: Slot['field'], value: number): EqBand {
  if (field === 'logHz') return { ...band, frequencyHz: 10 ** value };
  return field === 'q' ? { ...band, q: value } : { ...band, gainDb: value };
}

const STEP_FOR: Record<Slot['field'], number> = { logHz: 1e-4, q: 1e-3, gainDb: 1e-3 };

/** Gaussian elimination with pivoting. Null when it's singular. */
function solved(matrix: number[][], right: number[]): number[] | null {
  const size = right.length;
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(matrix[row]?.[column] ?? 0) > Math.abs(matrix[pivot]?.[column] ?? 0)) pivot = row;
    }
    const top = matrix[pivot] ?? [];
    if (Math.abs(top[column] ?? 0) < 1e-14) return null;
    [matrix[column], matrix[pivot]] = [top, matrix[column] ?? []];
    [right[column], right[pivot]] = [right[pivot] ?? 0, right[column] ?? 0];
    for (let row = column + 1; row < size; row++) {
      const line = matrix[row] ?? [];
      const share = (line[column] ?? 0) / (top[column] ?? 1);
      if (share === 0) continue;
      for (let cell = column; cell < size; cell++) line[cell] = (line[cell] ?? 0) - share * (top[cell] ?? 0);
      right[row] = (right[row] ?? 0) - share * (right[column] ?? 0);
    }
  }
  const out = right.map(() => 0);
  for (let row = size - 1; row >= 0; row--) {
    let sum = right[row] ?? 0;
    for (let cell = row + 1; cell < size; cell++) sum -= (matrix[row]?.[cell] ?? 0) * (out[cell] ?? 0);
    out[row] = sum / (matrix[row]?.[row] ?? 1);
  }
  return out;
}

/** Only what's in the low end stays free, and it stays there. */
function lowEndSlots(bands: readonly EqBand[], topHz: number): Slot[] {
  const isLowEnd = ({ kind, frequencyHz }: EqBand) => kind === 'lowshelf' || (kind === 'peak' && frequencyHz <= topHz);
  return slotsOf(bands)
    .filter(({ band }) => isLowEnd(bands[band] as EqBand))
    .map((slot) => (slot.field === 'logHz' ? { ...slot, high: Math.log10(topHz) } : slot));
}

/** Levenberg-Marquardt, leaving out whatever is at a bound and being pushed further into it. Nothing random, so it's repeatable. */
function minimized(problem: Problem, start: readonly EqBand[], onlyUpToHz: number | null = null): EqBand[] {
  const slots = onlyUpToHz === null ? slotsOf(start) : lowEndSlots(start, onlyUpToHz);
  let bands = [...start];
  let responses = bands.map((band) => responseOf(band, problem.hz));
  let current = residuals(problem, bands, responses);
  let cost = costOf(current);
  let damping = 1e-3;

  for (let step = 0; step < MOST_STEPS; step++) {
    const columns = slots.map(({ band, field, high }) => {
      const value = readSlot(bands[band] as EqBand, field);
      const nudge = value + STEP_FOR[field] > high ? -STEP_FOR[field] : STEP_FOR[field];
      const moved = withSlot(bands[band] as EqBand, field, value + nudge);
      const nextBands = bands.map((item, index) => (index === band ? moved : item));
      const nextResponses = responses.map((item, index) => (index === band ? responseOf(moved, problem.hz) : item));
      const shifted = residuals(problem, nextBands, nextResponses);
      return shifted.map((item, row) => (item - (current[row] ?? 0)) / nudge);
    });
    const gradient = columns.map((column) => column.reduce((sum, item, row) => sum + item * (current[row] ?? 0), 0));
    const free = slots.flatMap((slot, index) => {
      const value = readSlot(bands[slot.band] as EqBand, slot.field);
      const push = gradient[index] ?? 0;
      return (value <= slot.low && push > 0) || (value >= slot.high && push < 0) ? [] : [index];
    });
    const normal = free.map((one) =>
      free.map((other) =>
        (columns[one] ?? []).reduce((sum, item, row) => sum + item * (columns[other]?.[row] ?? 0), 0),
      ),
    );

    let improved = false;
    while (damping < 1e10) {
      const damped = normal.map((line, row) =>
        line.map((cell, column) => (row === column ? cell * (1 + damping) + 1e-12 : cell)),
      );
      const move = solved(
        damped,
        free.map((index) => -(gradient[index] ?? 0)),
      );
      if (move === null) {
        damping *= 4;
        continue;
      }
      let nextBands = bands;
      for (const [position, index] of free.entries()) {
        const { band, field, low, high } = slots[index] as Slot;
        const item = nextBands[band] as EqBand;
        const value = clamp(readSlot(item, field) + (move[position] ?? 0), low, high);
        nextBands = nextBands.map((other, at) => (at === band ? withSlot(item, field, value) : other));
      }
      const nextResponses = nextBands.map((item, index) =>
        item === bands[index] ? (responses[index] ?? []) : responseOf(item, problem.hz),
      );
      const next = residuals(problem, nextBands, nextResponses);
      const nextCost = costOf(next);
      if (nextCost < cost) {
        const gain = (cost - nextCost) / cost;
        bands = nextBands;
        responses = nextResponses;
        current = next;
        cost = nextCost;
        damping = Math.max(damping / 3, 1e-9);
        improved = gain > SMALLEST_GAIN_RATIO;
        break;
      }
      damping *= 4;
    }
    if (!improved) break;
  }
  return bands;
}

/** AutoEq's starting point: the biggest peak or dip left, by height times width, with a width to suit it. */
function peakStart(remaining: readonly number[], hz: readonly number[], id: number): EqBand {
  const heights = (sign: 1 | -1) => remaining.map((value) => Math.max(0, value * sign));
  const inRange = (index: number) => (hz[index] ?? 0) >= PEAK_LOW_HZ && (hz[index] ?? 0) <= PEAK_HIGH_HZ * FIT_STEP;
  const candidates = ([1, -1] as const).flatMap((sign) => {
    const values = heights(sign);
    return findPeaks(values)
      .filter(({ index }) => inRange(index))
      .map((peak) => ({ ...peak, sign, height: values[peak.index] ?? 0 }));
  });
  let best = candidates[0];
  for (const candidate of candidates) {
    if (best === undefined || candidate.width * candidate.height > best.width * best.height) best = candidate;
  }
  const middleHz = Math.sqrt(PEAK_LOW_HZ * PEAK_HIGH_HZ);
  if (best === undefined) return { id, kind: 'peak', frequencyHz: middleHz, q: Math.SQRT2, gainDb: 0 };
  const octaves = best.width * Math.log2(FIT_STEP);
  const span = 2 ** octaves;
  const q = span > 1 ? Math.sqrt(span) / (span - 1) : PEAK_MAX_Q;
  return {
    id,
    kind: 'peak',
    frequencyHz: clamp(hz[best.index] ?? middleHz, PEAK_LOW_HZ, PEAK_HIGH_HZ),
    q: clamp(q, PEAK_MIN_Q, PEAK_MAX_Q),
    gainDb: clamp(best.height * best.sign, -EQ_MAX_GAIN_DB, EQ_MAX_GAIN_DB),
  };
}

function shelfStart(
  kind: 'lowshelf' | 'highshelf',
  remaining: readonly number[],
  hz: readonly number[],
  id: number,
): EqBand {
  const frequencyHz = kind === 'lowshelf' ? SHELF_LOW_HZ : SHELF_HIGH_HZ;
  const unit = responseOf({ id, kind, frequencyHz, q: SHELF_Q, gainDb: 1 }, hz);
  let weighted = 0;
  let weights = 0;
  for (const [point, weight] of unit.entries()) {
    weighted += (remaining[point] ?? 0) * weight;
    weights += weight;
  }
  const gainDb = clamp(weighted / weights, -EQ_MAX_GAIN_DB, EQ_MAX_GAIN_DB);
  return { id, kind, frequencyHz, q: SHELF_Q, gainDb };
}

function startingBands(aim: readonly number[], hz: readonly number[], peakCount: number): EqBand[] {
  let remaining = [...aim];
  const take = (band: EqBand) => {
    const response = responseOf(band, hz);
    remaining = remaining.map((value, point) => value - (response[point] ?? 0));
    return band;
  };
  const high = take(shelfStart('highshelf', remaining, hz, 1));
  const low = take(shelfStart('lowshelf', remaining, hz, 2));
  const peaks: EqBand[] = [];
  for (let peak = 0; peak < peakCount; peak++) peaks.push(take(peakStart(remaining, hz, peak + 3)));
  return [low, ...peaks, high];
}

const LIMIT_CHECK_STEP = 1.005;
const LOW_END_FIT_TOP_HZ = 500;
const GAIN_STEP_DB = 0.1;

function rounded(band: EqBand): EqBand {
  return {
    ...band,
    frequencyHz: Math.round(band.frequencyHz),
    q: Math.round(band.q * 100) / 100,
    gainDb: Math.round(band.gainDb * 10) / 10,
  };
}

/** Rounding or a stubborn overshoot can still leave the fit over the limit by a little, and the low shelf is what can take it down. */
function heldUnderLimit(bands: readonly EqBand[], bassLimitDb: number): EqBand[] {
  const points = matchGrid(LIMIT_CHECK_STEP).filter((hz) => hz <= LOW_END_TOP_HZ);
  let out = [...bands];
  for (let tries = 0; tries < 200; tries++) {
    let over = -Infinity;
    for (const hz of points) over = Math.max(over, curveDb(out, hz, CURVE_SAMPLE_RATE) - bassLimitDb);
    if (over <= 0) return out;
    const down = Math.max(GAIN_STEP_DB, Math.ceil(over / GAIN_STEP_DB) * GAIN_STEP_DB);
    out = out.map((band) =>
      band.kind === 'lowshelf'
        ? { ...band, gainDb: Math.max(-EQ_MAX_GAIN_DB, Math.round((band.gainDb - down) * 10) / 10) }
        : band,
    );
  }
  return out;
}

function problemOf(correction: FrCurve, bassLimitDb: number): Problem {
  const hz = matchGrid(FIT_STEP);
  return {
    hz,
    aim: hz.map((at) => heldValueAt(correction, at)),
    averagedFrom: hz.findIndex((at) => at >= AVERAGED_ABOVE_HZ),
    limits: hz.map((at) => boostCapDb(at, bassLimitDb)),
  };
}

function finished(bands: readonly EqBand[], bassLimitDb: number): EqBand[] {
  const order = (kind: EqBand['kind']) => ['lowshelf', 'peak', 'highshelf'].indexOf(kind);
  return heldUnderLimit(bands.map(rounded), bassLimitDb)
    .filter(({ gainDb }) => gainDb !== 0)
    .toSorted((one, other) => order(one.kind) - order(other.kind) || one.frequencyHz - other.frequencyHz)
    .map((band, index) => ({ ...band, id: index + 1 }));
}

/** The bands for one correction curve, from AutoEq's starting point. */
export function fitBands(correction: FrCurve, maxBands: number, bassLimitDb: number): EqBand[] {
  const problem = problemOf(correction, bassLimitDb);
  const start = startingBands(problem.aim, problem.hz, Math.max(0, maxBands - 2));
  return finished(minimized(problem, start), bassLimitDb);
}

export type MatchInput = {
  measurement: FrCurve;
  target: FrCurve;
  bassDb: number;
  maxBands: number;
  settings: MatchSettings;
};

/**
 * An EQ that takes the measurement towards the target, both aligned by the rule on screen, with Bass as it's drawn on the target.
 * It stops at the caps on boost, so a line far under the target stays under it: that's on purpose. The low-end settings only
 * move the low bands of the fit without them, or the fit could land somewhere else and a change in the bass would move the treble.
 */
export function matchBands({ measurement, target, bassDb, maxBands, settings }: MatchInput): EqBand[] {
  const measured = measuredLine(measurement, true);
  const aligned = targetLine(target, 0);
  const { correctUpToHz } = settings;
  const plain = problemOf(
    correctionCurve(measured, aligned, { ...MATCH_DEFAULTS, correctUpToHz, bassDb: 0 }),
    MATCH_DEFAULTS.bassLimitDb,
  );
  const start = minimized(plain, startingBands(plain.aim, plain.hz, Math.max(0, maxBands - 2)));
  const isPlain =
    bassDb === 0 && settings.bassLimitDb === MATCH_DEFAULTS.bassLimitDb && settings.seal === MATCH_DEFAULTS.seal;
  if (isPlain) return finished(start, settings.bassLimitDb);
  const wanted = problemOf(correctionCurve(measured, aligned, { ...settings, bassDb }), settings.bassLimitDb);
  return finished(minimized(wanted, start, LOW_END_FIT_TOP_HZ), settings.bassLimitDb);
}
