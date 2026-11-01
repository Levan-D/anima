/* The EQ's sums for the screen: where a band sits on the plot, the steps it moves in, and what its values are called. */

import {
  EQ_MAX_GAIN_DB,
  EQ_MAX_HZ,
  EQ_MAX_PREAMP_DB,
  EQ_MAX_Q,
  EQ_MIN_HZ,
  EQ_MIN_PREAMP_DB,
  EQ_MIN_Q,
  type EqBand,
  type EqBandKind,
  type EqPreamp,
  type PlayerState,
} from '@shared/domain';
import { CURVE_SAMPLE_RATE, curveDb, isBandActive } from '@shared/eqCurve';

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

const DECADES = Math.log10(EQ_MAX_HZ / EQ_MIN_HZ);

/** Across the plot, from 0 to 1. */
export function xOfHz(hz: number): number {
  return Math.log10(hz / EQ_MIN_HZ) / DECADES;
}

/** For what's placed over the plot, as a share of its width. */
export function leftAt(hz: number): { left: string } {
  return { left: `${xOfHz(hz) * 100}%` };
}

export function spanAt(lowHz: number, highHz: number): { left: string; width: string } {
  // Below the plot is off its edge, as a pipe organ's lowest notes are.
  const from = Math.max(lowHz, EQ_MIN_HZ);
  return { ...leftAt(from), width: `${(xOfHz(highHz) - xOfHz(from)) * 100}%` };
}

export function hzOfX(x: number): number {
  return EQ_MIN_HZ * 10 ** (clamp(x, 0, 1) * DECADES);
}

/** Down the plot, from 0 to 1. */
export function yOfGain(gainDb: number): number {
  return 0.5 - gainDb / (2 * EQ_MAX_GAIN_DB);
}

export function topAt(y: number): { top: string } {
  return { top: `${y * 100}%` };
}

export function gainOfY(y: number): number {
  return (0.5 - clamp(y, 0, 1)) * 2 * EQ_MAX_GAIN_DB;
}

export function roundHz(hz: number): number {
  const decimals = 2 - Math.floor(Math.log10(Math.max(hz, 1)));
  const unit = 10 ** -Math.min(decimals, 1);
  return clamp(Number((Math.round(hz / unit) * unit).toFixed(1)), EQ_MIN_HZ, EQ_MAX_HZ);
}

export function roundGain(gainDb: number): number {
  return clamp(Math.round(gainDb * 10) / 10, -EQ_MAX_GAIN_DB, EQ_MAX_GAIN_DB);
}

const FLAT_SNAP_DB = 0.3;

/** A drag lands on exactly flat from close by, or it would take a steady hand to get bit-perfect back. */
export function dragGain(gainDb: number): number {
  return Math.abs(gainDb) < FLAT_SNAP_DB ? 0 : roundGain(gainDb);
}

/** Where a node is drawn: on the curve, at its own frequency. */
export function nodeDb(bands: readonly EqBand[], band: EqBand, sampleRate: number): number {
  // Off the end of this file's curve, so it stays where its own gain puts it and can still be dragged.
  const db = isBandActive(band, sampleRate) ? curveDb(bands, band.frequencyHz, sampleRate) : band.gainDb;
  return clamp(db, -EQ_MAX_GAIN_DB, EQ_MAX_GAIN_DB);
}

// How much of its gain an RBJ filter has at its own frequency, in dB, whatever the Q: all of it on a peak, half on a shelf.
const SHARE_AT_OWN_HZ: Record<EqBandKind, number> = { peak: 1, lowshelf: 0.5, highshelf: 0.5 };

/** The gain that puts this band's node at `curveAtHz` on the curve, so it stays under the finger whatever else is there. */
export function gainForNode(
  bands: readonly EqBand[],
  band: EqBand,
  hz: number,
  curveAtHz: number,
  sampleRate: number,
): number {
  if (!isBandActive({ frequencyHz: hz }, sampleRate)) return dragGain(curveAtHz);
  const others = bands.filter(({ id }) => id !== band.id);
  return dragGain((curveAtHz - curveDb(others, hz, sampleRate)) / SHARE_AT_OWN_HZ[band.kind]);
}

function typedNumber(text: string): number | null {
  const number = Number.parseFloat(text.replace('−', '-'));
  return Number.isNaN(number) ? null : number;
}

/** What the filters really run at: the track's own rate, since the curve differs per rate. Mpv's word first, then the library's. */
export function curveRateOf({ signal, current }: Pick<PlayerState, 'signal' | 'current'>): number {
  return signal.decoded?.sampleRate ?? current?.sampleRate ?? CURVE_SAMPLE_RATE;
}

/** Hz, or kHz if it says so with a k. */
export function typedHz(text: string): number | null {
  const number = typedNumber(text);
  if (number === null) return null;
  return roundHz(/k/i.test(text) ? number * 1000 : number);
}

export function typedGain(text: string): number | null {
  const number = typedNumber(text);
  return number === null ? null : roundGain(number);
}

export function typedPreamp(text: string): number | null {
  const number = typedNumber(text);
  return number === null ? null : clamp(Math.round(number * 10) / 10, EQ_MIN_PREAMP_DB, EQ_MAX_PREAMP_DB);
}

export function typedQ(text: string): number | null {
  const number = typedNumber(text);
  return number === null ? null : stepQ(number, 0);
}

export function isFlat(bands: readonly EqBand[]): boolean {
  return bands.every(({ gainDb }) => gainDb === 0);
}

export function stepHz(hz: number, octaves: number): number {
  return roundHz(hz * 2 ** octaves);
}

export function stepGain(gainDb: number, deltaDb: number): number {
  return roundGain(gainDb + deltaDb);
}

export function stepQ(q: number, octaves: number): number {
  return clamp(Math.round(q * 2 ** octaves * 100) / 100, EQ_MIN_Q, EQ_MAX_Q);
}

export const KIND_WORDS: Record<EqBandKind, string> = { peak: 'Peak', lowshelf: 'Low shelf', highshelf: 'High shelf' };

export function hzWords(hz: number): string {
  return hz >= 1000 ? `${Number((hz / 1000).toFixed(2))} kHz` : `${Number(hz.toFixed(1))} Hz`;
}

export function gainWords(gainDb: number): string {
  if (gainDb === 0) return '0 dB';
  return `${gainDb > 0 ? '+' : '−'}${Math.abs(gainDb).toFixed(1)} dB`;
}

export function qWords(q: number): string {
  return q.toFixed(2);
}

/** Each band's place left to right, by id. Ties go by id, so two on the same frequency keep their order. */
export function bandNumbers(bands: readonly EqBand[]): Map<number, number> {
  const ordered = [...bands].sort((one, other) => one.frequencyHz - other.frequencyHz || one.id - other.id);
  return new Map(ordered.map(({ id }, index) => [id, index + 1]));
}

/** A new peak with its node where the pointer is, on the curve as it stands. */
export function bandAtPoint(bands: readonly EqBand[], x: number, y: number, sampleRate: number): EqBand {
  const band = { ...newBand(bands), frequencyHz: roundHz(hzOfX(x)) };
  return { ...band, gainDb: gainForNode(bands, band, band.frequencyHz, gainOfY(y), sampleRate) };
}

export function gainMarks(maxDb: number): { gainDb: number; words: string }[] {
  const marks = [];
  for (let gainDb = maxDb; gainDb >= -maxDb; gainDb -= 3) {
    const sign = gainDb > 0 ? '+' : '−';
    marks.push({ gainDb, words: gainDb === 0 ? '0' : `${sign}${Math.abs(gainDb)}` });
  }
  return marks;
}

/** A frequency line's label: "100", or "4k". */
export function hzMarkWords(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : String(hz);
}

/** Whether these are what a preset says, ids aside. */
export function samePresetBands(one: readonly EqBand[], other: readonly EqBand[]): boolean {
  return (
    one.length === other.length &&
    one.every((band, index) => {
      const twin = other[index];
      return (
        twin !== undefined &&
        band.kind === twin.kind &&
        band.frequencyHz === twin.frequencyHz &&
        band.gainDb === twin.gainDb &&
        band.q === twin.q
      );
    })
  );
}

export function samePreamp(one: EqPreamp, other: EqPreamp): boolean {
  return one.auto === other.auto && (one.auto || one.db === other.db);
}

const PATH_POINTS = 240;
const VIEW = 1000;

/** The curve in a viewBox of 1000 by 1000, for an SVG stretched to whatever the plot's shape is. A low-rate file's ends at its Nyquist. */
export function curvePath(bands: readonly EqBand[], sampleRate: number): string {
  const lastX = Math.min(1, xOfHz(sampleRate / 2));
  const points: string[] = [];
  for (let point = 0; point <= PATH_POINTS; point++) {
    const x = (point / PATH_POINTS) * lastX;
    const y = yOfGain(clamp(curveDb(bands, hzOfX(x), sampleRate), -EQ_MAX_GAIN_DB, EQ_MAX_GAIN_DB));
    points.push(`${(x * VIEW).toFixed(1)} ${(y * VIEW).toFixed(1)}`);
  }
  return `M${points.join('L')}`;
}

/** Where a curve from `curvePath` stops across the viewBox, for closing the shape under it. */
export function curveEndX(sampleRate: number): number {
  return Math.min(1, xOfHz(sampleRate / 2)) * VIEW;
}

const BUTTERWORTH_Q = 0.707;

export const DEFAULT_BANDS: readonly EqBand[] = [
  { id: 1, kind: 'lowshelf', frequencyHz: 80, gainDb: 0, q: BUTTERWORTH_Q },
  { id: 2, kind: 'peak', frequencyHz: 250, gainDb: 0, q: 1 },
  { id: 3, kind: 'peak', frequencyHz: 1000, gainDb: 0, q: 1 },
  { id: 4, kind: 'peak', frequencyHz: 4000, gainDb: 0, q: 1 },
  { id: 5, kind: 'highshelf', frequencyHz: 12_000, gainDb: 0, q: BUTTERWORTH_Q },
];

/** A flat peak in the middle of the widest gap, so it starts where there's room and changes nothing until it's moved. */
export function newBand(bands: readonly EqBand[]): EqBand {
  const edges = [EQ_MIN_HZ, ...bands.map(({ frequencyHz }) => frequencyHz).sort((a, b) => a - b), EQ_MAX_HZ];
  let at = EQ_MIN_HZ;
  let widest = -1;
  for (const [index, low] of edges.entries()) {
    const high = edges[index + 1];
    if (high === undefined) break;
    const gap = xOfHz(high) - xOfHz(low);
    if (gap > widest) {
      widest = gap;
      at = Math.sqrt(low * high);
    }
  }
  const id = Math.max(0, ...bands.map((band) => band.id)) + 1;
  return { id, kind: 'peak', frequencyHz: roundHz(at), gainDb: 0, q: 1 };
}
