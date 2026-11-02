/*
 * The curve a headphone correction aims for: what's wrong with a measurement against a target, smoothed and limited until it's
 * safe to chase. A port of FrequencyResponse.equalize from AutoEq's frequency_response.py, with SciPy's savgol_filter and
 * find_peaks written out, at the commit in AUTOEQ_COMMIT. MIT, (c) Jaakko Pasanen: THIRD_PARTY_NOTICES.md has the notice.
 * Differences from it, and why: docs/research/headphone-eq.md, under "Match to target". Pure.
 */

import { BOOST_CAP_DB, MATCH_DEFAULTS, type FrCurve, type MatchSettings, type SealFit } from '@shared/headphone';
import { bassShelfDb, valueAt } from '@shared/headphoneCurve';

const GRID_LOW_HZ = 20;
const GRID_HIGH_HZ = 20_000;

/** AutoEq's frequency grid, whose every point is `step` times the last. Its windows are counted in these points. */
export function matchGrid(step: number): number[] {
  const hz: number[] = [];
  for (let at = GRID_LOW_HZ; at <= GRID_HIGH_HZ; at *= step) hz.push(at);
  return hz;
}

/** A line's value at `at`, holding its end value past either end of what it covers. */
export function heldValueAt(curve: FrCurve, at: number): number {
  const first = curve.hz[0] ?? at;
  const last = curve.hz.at(-1) ?? at;
  return valueAt(curve, Math.min(Math.max(at, first), last)) ?? 0;
}

const CORRECTION_STEP = 1.01;

function windowPoints(octaves: number): number {
  const points = Math.round((octaves * Math.LN2) / Math.log(CORRECTION_STEP));
  return points % 2 === 0 ? points + 1 : points;
}

/** A least-squares parabola through a sliding window. At each end it's one parabola through the last whole window, as SciPy's. */
function savitzkyGolay(values: readonly number[], points: number): number[] {
  const reach = (points - 1) / 2;
  let sumSquares = 0;
  let sumFourths = 0;
  for (let offset = -reach; offset <= reach; offset++) {
    sumSquares += offset ** 2;
    sumFourths += offset ** 4;
  }
  const divisor = points * sumFourths - sumSquares ** 2;

  function fitAround(centre: number, at: number): number {
    let sum = 0;
    let sumTimes = 0;
    let sumTimesSquared = 0;
    for (let offset = -reach; offset <= reach; offset++) {
      const value = values[centre + offset] ?? 0;
      sum += value;
      sumTimes += offset * value;
      sumTimesSquared += offset ** 2 * value;
    }
    const constant = (sumFourths * sum - sumSquares * sumTimesSquared) / divisor;
    const square = (points * sumTimesSquared - sumSquares * sum) / divisor;
    return constant + (sumTimes / sumSquares) * at + square * at ** 2;
  }

  const lastCentre = values.length - 1 - reach;
  return values.map((_, point) => {
    if (point < reach) return fitAround(reach, point - reach);
    if (point > lastCentre) return fitAround(lastCentre, point - lastCentre);
    return fitAround(point, 0);
  });
}

export type Peak = { index: number; prominence: number; width: number };

/** SciPy's find_peaks with its prominence and its width at half that. A flat top counts once, at its middle. */
export function findPeaks(values: readonly number[]): Peak[] {
  const peaks: Peak[] = [];
  const at = (point: number) => values[point] ?? 0;
  for (let point = 1; point < values.length - 1; point++) {
    if (at(point - 1) >= at(point)) continue;
    let flatEnd = point;
    while (flatEnd < values.length - 1 && at(flatEnd + 1) === at(point)) flatEnd++;
    if (flatEnd < values.length - 1 && at(flatEnd + 1) < at(point)) {
      const index = (point + flatEnd) >> 1;
      peaks.push(described(values, index));
    }
    point = flatEnd;
  }
  return peaks;
}

function described(values: readonly number[], index: number): Peak {
  const at = (point: number) => values[point] ?? 0;
  const top = at(index);
  let leftLow = top;
  let leftBase = index;
  for (let point = index; point >= 0 && at(point) <= top; point--) {
    if (at(point) < leftLow) {
      leftLow = at(point);
      leftBase = point;
    }
  }
  let rightLow = top;
  let rightBase = index;
  for (let point = index; point < values.length && at(point) <= top; point++) {
    if (at(point) < rightLow) {
      rightLow = at(point);
      rightBase = point;
    }
  }
  const prominence = top - Math.max(leftLow, rightLow);
  const height = top - prominence / 2;
  let left = index;
  while (leftBase < left && height < at(left)) left--;
  const leftEdge = at(left) < height ? left + (height - at(left)) / (at(left + 1) - at(left)) : left;
  let right = index;
  while (right < rightBase && height < at(right)) right++;
  const rightEdge = at(right) < height ? right - (height - at(right)) / (at(right - 1) - at(right)) : right;
  return { index, prominence, width: rightEdge - leftEdge };
}

function prominentIndexes(values: readonly number[]): number[] {
  return findPeaks(values)
    .filter(({ prominence }) => prominence >= 1)
    .map(({ index }) => index);
}

/** Around a dip deeper than the dips beside it, the slope limit doesn't apply, so filling it never gets steeper to get there. */
function protectedAroundDips(y: readonly number[], peaks: readonly number[], dips: readonly number[]): boolean[] {
  const lowest = Math.min(...y);
  const lastPeak = peaks.at(-1);
  const lastDip = dips.at(-1);
  const levelled =
    lastPeak !== undefined && (lastDip === undefined || lastPeak > lastDip)
      ? [...dips.map((index) => ({ index, level: y[index] ?? 0 })), lastLowAfter(y, lastPeak)]
      : [...dips.map((index) => ({ index, level: y[index] ?? 0 })), { index: -1, level: lowest }];

  const mask = y.map(() => false);
  for (let dip = 1; dip < levelled.length - 1; dip++) {
    const { index } = levelled[dip] ?? { index: 0 };
    const leftLevel = levelled[dip - 1]?.level ?? 0;
    const rightLevel = levelled[dip + 1]?.level ?? 0;
    let left = index - 1;
    while (left >= 0 && (y[left] ?? 0) < leftLevel) left--;
    let right = index;
    while (right < y.length && (y[right] ?? 0) < rightLevel) right++;
    for (let point = left + 1; point <= right - 1; point++) mask[point] = true;
  }
  return mask;
}

function lastLowAfter(y: readonly number[], peak: number): { index: number; level: number } {
  let index = peak;
  for (let point = peak; point < y.length; point++) if ((y[point] ?? 0) < (y[index] ?? 0)) index = point;
  return { index, level: y[index] ?? 0 };
}

function rightToLeftStart(y: readonly number[], peaks: readonly number[], dips: readonly number[]): number {
  const lastPeak = peaks.at(-1);
  const lastDip = dips.at(-1);
  if (lastPeak === undefined || (lastDip !== undefined && lastPeak <= lastDip)) return lastDip ?? 0;
  const level = lastDip === undefined ? Math.max(y[0] ?? 0, y.at(-1) ?? 0) : (y[lastDip] ?? 0);
  for (let point = lastPeak; point < y.length; point++) if ((y[point] ?? 0) <= level) return point;
  return y.length - 1;
}

const MAX_SLOPE_DB_PER_OCTAVE = 18;

/** One pass of the limit on how fast the curve may rise. A limited stretch that never reached a peak is put back as it was. */
function limitRise(
  hz: readonly number[],
  y: readonly number[],
  start: number,
  peaks: readonly number[],
  isFree: readonly boolean[],
): number[] {
  const limited: number[] = [];
  const clipped: boolean[] = [];
  let regionStart = 0;
  for (let point = 0; point < y.length; point++) {
    const value = y[point] ?? 0;
    if (point <= start) {
      limited.push(value);
      clipped.push(false);
      continue;
    }
    const octaves = Math.log2((hz[point] ?? 1) / (hz[point - 1] ?? 1));
    const before = limited[point - 1] ?? 0;
    const wasClipped = clipped[point - 1] ?? false;
    if ((value - before) / octaves > MAX_SLOPE_DB_PER_OCTAVE && !(isFree[point] ?? false)) {
      if (!wasClipped) regionStart = point;
      clipped.push(true);
      limited.push(before + MAX_SLOPE_DB_PER_OCTAVE * octaves);
      continue;
    }
    limited.push(value);
    clipped.push(false);
    if (wasClipped && !peaks.some((peak) => peak >= regionStart && peak < point)) {
      for (let back = regionStart; back < point; back++) {
        limited[back] = y[back] ?? 0;
        clipped[back] = false;
      }
    }
  }
  return limited;
}

const flipped = (peaks: readonly number[], length: number) => peaks.map((peak) => length - 1 - peak);

const TREBLE_LOW_HZ = 6000;
const TREBLE_HIGH_HZ = 8000;
const NORMAL_WINDOW_OCTAVES = 1 / 12;
const TREBLE_WINDOW_OCTAVES = 2;
const FINAL_WINDOW_OCTAVES = 1 / 5;

/** How far into the wide treble smoothing a frequency is: AutoEq's sigmoid in log frequency. */
function trebleShare(hz: number): number {
  const centre = Math.log10(Math.sqrt(TREBLE_LOW_HZ * TREBLE_HIGH_HZ));
  const halfRange = Math.log10(TREBLE_HIGH_HZ) - centre;
  return 1 / (1 + Math.exp(-(Math.log10(hz) - centre) / (halfRange / 4)));
}

function smoothedError(hz: readonly number[], error: readonly number[]): number[] {
  const normal = savitzkyGolay(error, windowPoints(NORMAL_WINDOW_OCTAVES));
  const treble = savitzkyGolay(error, windowPoints(TREBLE_WINDOW_OCTAVES));
  return error.map((_, point) => {
    const share = trebleShare(hz[point] ?? 1);
    return (normal[point] ?? 0) * (1 - share) + (treble[point] ?? 0) * share;
  });
}

/** Up to here the listener's low-end settings hold in full. docs/research/headphone-eq.md, under "Match settings", has why. */
export const LOW_END_TOP_HZ = 100;

const eased = (through: number) => {
  const clamped = Math.min(Math.max(through, 0), 1);
  return clamped * clamped * (3 - 2 * clamped);
};

/** From `low` at and under the low end's top to `high` an octave above it. A step there would be a step in the correction. */
const overTheLowEnd = (hz: number, low: number, high: number) =>
  low + (high - low) * eased(Math.log2(hz / LOW_END_TOP_HZ));

/** The most boost allowed at a frequency. */
export function boostCapDb(hz: number, bassLimitDb: number): number {
  return overTheLowEnd(hz, bassLimitDb, BOOST_CAP_DB);
}

/** How much of what's measured under 100 Hz gets corrected. A judgement call, stated as one in the research file. */
const LOW_END_SHARE: Record<SealFit, number> = { open: 1, sealed: 0.75, varies: 0.5 };

const AVERAGE_ONLY_ABOVE_HZ = 10_000;
const TOP_FADE_OCTAVES = 0.5;

/** Whole up to the limit, and gone half an octave above it. At 10 kHz it's left to AutoEq's averaging, which only keeps the level. */
function shareUnderTop(hz: number, topHz: number): number {
  if (topHz >= AVERAGE_ONLY_ABOVE_HZ) return 1;
  return 1 - eased(Math.log2(hz / topHz) / TOP_FADE_OCTAVES);
}

export type CorrectionOptions = MatchSettings & { bassDb: number };

/**
 * What an EQ should do to bring `measured` to `target`, both already aligned as the caller means them. Below about 6 kHz it
 * follows closely, and above that it follows less and less, down to a 2 octave average, since a narrow treble feature on a rig
 * sits somewhere else on a head. Bass goes on after the share for the seal: it's a preference, and the seal says nothing about it.
 */
export function correctionCurve(
  measured: FrCurve,
  target: FrCurve,
  options: CorrectionOptions = { ...MATCH_DEFAULTS, bassDb: 0 },
): FrCurve {
  const { bassLimitDb, seal, correctUpToHz, bassDb } = options;
  const hz = matchGrid(CORRECTION_STEP);
  const error = hz.map((at) => heldValueAt(measured, at) - heldValueAt(target, at));
  const y = smoothedError(hz, error).map((value, point) => {
    const at = hz[point] ?? 1;
    const share = overTheLowEnd(at, LOW_END_SHARE[seal], 1) * shareUnderTop(at, correctUpToHz);
    return -value * share + bassShelfDb(at, bassDb);
  });

  const peaks = prominentIndexes(y);
  const dips = prominentIndexes(y.map((value) => -value));
  let limited: readonly number[] = y;
  if (peaks.length > 0 || dips.length > 0) {
    const isFree = protectedAroundDips(y, peaks, dips);
    const leftToRight = limitRise(hz, y, 0, peaks, isFree);
    const start = y.length - 1 - rightToLeftStart(y, peaks, dips);
    const rightToLeft = limitRise(
      hz,
      y.toReversed(),
      start,
      flipped(peaks, y.length),
      isFree.toReversed(),
    ).toReversed();
    limited = leftToRight.map((value, point) => Math.min(value, rightToLeft[point] ?? value));
  }
  const capOf = (point: number) => boostCapDb(hz[point] ?? 1, bassLimitDb);
  const capped = limited.map((value, point) => Math.min(value, capOf(point)));
  const smoothed = savitzkyGolay(capped, windowPoints(FINAL_WINDOW_OCTAVES));
  // The final smoothing can overshoot a cap by a little, and a limit the listener set has to hold.
  return { hz, db: smoothed.map((value, point) => Math.min(value, capOf(point))) };
}
