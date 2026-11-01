/*
 * The sums behind the headphone lines: alignment, smoothing, the predicted line, whether a target may be shown, and the level
 * for a matched comparison. Pure. docs/research/headphone-eq.md has the reasons, and what's refused.
 */

import { EQ_MAX_GAIN_DB, EQ_MAX_PREAMP_DB, EQ_MIN_PREAMP_DB, type EqBand, type EqSettings } from '@shared/domain';
import { CURVE_SAMPLE_RATE, curveDb, effectivePreampDb, isEqAudible } from '@shared/eqCurve';
import type { FrCurve, RigTag } from '@shared/headphone';

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** A line's value at `hz`, straight between points on a log axis. Null outside what the curve covers. */
export function valueAt({ hz, db }: FrCurve, at: number): number | null {
  const first = hz[0];
  const last = hz.at(-1);
  if (first === undefined || last === undefined || at < first || at > last) return null;
  let low = 0;
  let high = hz.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if ((hz[middle] ?? 0) <= at) low = middle;
    else high = middle;
  }
  const lowHz = hz[low] ?? at;
  const highHz = hz[high] ?? at;
  const lowDb = db[low] ?? 0;
  const highDb = db[high] ?? 0;
  if (highHz === lowHz) return lowDb;
  const share = Math.log(at / lowHz) / Math.log(highHz / lowHz);
  return lowDb + (highDb - lowDb) * share;
}

const GRID_PER_OCTAVE = 96;

/** Points per octave the smoothing runs on. Fine enough that a 1/12 octave window holds several even from a sparse file. */
function logGrid(lowHz: number, highHz: number): number[] {
  const count = Math.floor(Math.log2(highHz / lowHz) * GRID_PER_OCTAVE);
  return Array.from({ length: count + 1 }, (_, point) => lowHz * 2 ** (point / GRID_PER_OCTAVE));
}

export const SMOOTHING_OCTAVES = 1 / 12;

/**
 * A moving mean of the dB values, over `octaves` centred on each point. The window shrinks at the ends to stay centred, so a
 * slope stays where it is rather than bending as it reaches the edge.
 */
export function smooth(curve: FrCurve, octaves: number = SMOOTHING_OCTAVES): FrCurve {
  const first = curve.hz[0];
  const last = curve.hz.at(-1);
  if (first === undefined || last === undefined) return { hz: [], db: [] };
  const hz = logGrid(first, last);
  const values = hz.map((at) => valueAt(curve, at) ?? 0);
  const reach = Math.round((octaves * GRID_PER_OCTAVE) / 2);
  const sums = [0];
  for (const value of values) sums.push((sums.at(-1) ?? 0) + value);
  const db = values.map((_, point) => {
    const side = Math.min(reach, point, values.length - 1 - point);
    return ((sums[point + side + 1] ?? 0) - (sums[point - side] ?? 0)) / (2 * side + 1);
  });
  return { hz, db };
}

export const ALIGN_LOW_HZ = 300;
export const ALIGN_HIGH_HZ = 3000;

/**
 * What to add to put a curve's middle at 0 dB: the mean of 300 Hz to 3 kHz of its smoothed self, equal per octave. A single
 * frequency would let a local wiggle shift the whole reading. It only moves the picture, never the sound.
 */
export function alignmentDb(curve: FrCurve): number {
  const { hz, db } = smooth(curve);
  let sum = 0;
  let count = 0;
  for (const [point, at] of hz.entries()) {
    if (at < ALIGN_LOW_HZ || at > ALIGN_HIGH_HZ) continue;
    sum += db[point] ?? 0;
    count++;
  }
  return count === 0 ? 0 : -sum / count;
}

const shifted = ({ hz, db }: FrCurve, by: number): FrCurve => ({ hz, db: db.map((value) => value + by) });

/** A plain line is all that goes on screen, so a file with far more points than pixels is averaged into bins to draw. */
const MOST_POINTS = 1600;

function thinned({ hz, db }: FrCurve): FrCurve {
  if (hz.length <= MOST_POINTS) return { hz, db };
  const out: FrCurve = { hz: [], db: [] };
  const step = hz.length / MOST_POINTS;
  for (let bin = 0; bin < MOST_POINTS; bin++) {
    const from = Math.floor(bin * step);
    const to = Math.floor((bin + 1) * step);
    let sumHz = 0;
    let sumDb = 0;
    for (let point = from; point < to; point++) {
      sumHz += Math.log(hz[point] ?? 1);
      sumDb += db[point] ?? 0;
    }
    out.hz.push(Math.exp(sumHz / (to - from)));
    out.db.push(sumDb / (to - from));
  }
  return out;
}

/** What's drawn as measured: aligned by the rule whichever is showing, so switching to raw doesn't move it. */
export function measuredLine(curve: FrCurve, showRaw: boolean): FrCurve {
  const by = alignmentDb(curve);
  return shifted(showRaw ? thinned(curve) : smooth(curve), by);
}

/**
 * Measured plus the real curve at this file's rate. Nothing else: no smoothing beyond what `measured` already has, no shift, no
 * preamp, and nothing above this file's Nyquist, where it has nothing to say.
 */
export function predictedLine(measured: FrCurve, bands: readonly EqBand[], sampleRate: number): FrCurve {
  const nyquist = sampleRate / 2;
  const out: FrCurve = { hz: [], db: [] };
  for (const [point, at] of measured.hz.entries()) {
    if (at > nyquist) break;
    out.hz.push(at);
    out.db.push((measured.db[point] ?? 0) + curveDb(bands, at, sampleRate));
  }
  return out;
}

// The shape AutoEq gives a target's bass in dbtools/create_webapp_data.py. The amount is Olive's: see TARGET_BASS_MIN_DB.
const BASS_SHELF_HZ = 105;
const BASS_SHELF_Q = 0.7;

/** Aligned by the same rule as a measurement, then the bass on top, so the bass doesn't drag the rest of it along. */
export function targetLine(curve: FrCurve, bassDb: number): FrCurve {
  const line = shifted(smooth(curve), alignmentDb(curve));
  if (bassDb === 0) return line;
  const shelf: EqBand = { id: 1, kind: 'lowshelf', frequencyHz: BASS_SHELF_HZ, gainDb: bassDb, q: BASS_SHELF_Q };
  return {
    hz: line.hz,
    db: line.db.map((value, point) => value + curveDb([shelf], line.hz[point] ?? 0, CURVE_SAMPLE_RATE)),
  };
}

/** A line less the target, where the target has something to say. */
export function differenceLine(line: FrCurve, target: FrCurve): FrCurve {
  const out: FrCurve = { hz: [], db: [] };
  for (const [point, at] of line.hz.entries()) {
    const against = valueAt(target, at);
    if (against === null) continue;
    out.hz.push(at);
    out.db.push((line.db[point] ?? 0) - against);
  }
  return out;
}

export type RigMatch = 'defined' | 'approximate' | 'different' | 'unknown';

/**
 * Whether a target may be drawn against a measurement. Three states and one that can't be known: the same rig, the same family of
 * rig, and another. Rigs that differ aren't comparable and no delta curve makes them so, so 'different' and 'unknown' stay hidden.
 */
export function rigMatch(measurement: RigTag, target: { rig: RigTag; isTranslated: boolean }): RigMatch {
  if (measurement.family === 'unknown' || target.rig.family === 'unknown') return 'unknown';
  if (measurement.family !== target.rig.family) return 'different';
  const isSameRig =
    measurement.detail !== null && measurement.detail.toLowerCase() === target.rig.detail?.toLowerCase();
  return isSameRig && !target.isTranslated ? 'defined' : 'approximate';
}

const PLOT_LEAST_DB = 18;
const PLOT_MOST_DB = 36;
const PLOT_STEP_DB = 6;
// Up to here is what the graph trusts at all, and what's above it can't be allowed to squeeze everything else.
const PLOT_TOP_HZ = 10_000;

/** One scale for every line, wide enough for this measurement. It doesn't follow the EQ, or the plot would move under a drag. */
export function plotRangeDb(lines: readonly FrCurve[]): number {
  let furthest: number = EQ_MAX_GAIN_DB;
  for (const { hz, db } of lines) {
    for (const [point, at] of hz.entries()) {
      if (at <= PLOT_TOP_HZ) furthest = Math.max(furthest, Math.abs(db[point] ?? 0));
    }
  }
  return clamp(Math.ceil(furthest / PLOT_STEP_DB) * PLOT_STEP_DB, PLOT_LEAST_DB, PLOT_MOST_DB);
}

const MATCH_LOW_HZ = 100;
const MATCH_HIGH_HZ = 10_000;
const MATCH_POINTS = 256;

/**
 * What the whole EQ does to pink noise between 100 Hz and 10 kHz: the power mean of curve and preamp, equal per octave. That's a
 * sum over the curve, not a loudness model, so it's a level to compare at and not a claim that the two are equally loud.
 */
export function eqLevelDb(eq: Pick<EqSettings, 'bands' | 'preamp'>, sampleRate: number): number {
  const ratio = (MATCH_HIGH_HZ / MATCH_LOW_HZ) ** (1 / (MATCH_POINTS - 1));
  let power = 0;
  for (let point = 0, hz = MATCH_LOW_HZ; point < MATCH_POINTS; point++, hz *= ratio) {
    power += 10 ** (curveDb(eq.bands, Math.min(hz, sampleRate / 2), sampleRate) / 10);
  }
  return 10 * Math.log10(power / MATCH_POINTS) + effectivePreampDb(eq);
}

export type MatchedOff = {
  /** The same chain with every band at 0 dB, so going to it and back moves values without rebuilding the filters. */
  eq: EqSettings;
  gainDb: number;
  /** By how much the off side is still quieter than the on side, because it can't be taken louder than the file. */
  shortByDb: number;
};

/** The EQ's off side at the EQ's level. It only ever comes down, since going up would clip what's otherwise untouched. */
export function matchedOff(eq: EqSettings, sampleRate: number): MatchedOff {
  const level = eqLevelDb(eq, sampleRate);
  const gainDb = clamp(Math.round(level * 100) / 100, EQ_MIN_PREAMP_DB, Math.min(EQ_MAX_PREAMP_DB, 0));
  return {
    eq: { enabled: true, bands: eq.bands.map((band) => ({ ...band, gainDb: 0 })), preamp: { auto: false, db: gainDb } },
    gainDb,
    shortByDb: Math.max(0, Math.round((level - gainDb) * 10) / 10),
  };
}

/** Only with something to compare. */
export function canCompare(eq: EqSettings): boolean {
  return isEqAudible(eq) && eq.bands.some(({ gainDb }) => gainDb !== 0);
}
