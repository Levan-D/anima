import { describe, expect, it } from 'vitest';
import { curveDb } from '@shared/eqCurve';
import { EQ_MAX_BANDS, EQ_MAX_GAIN_DB, EQ_MAX_Q, EQ_MIN_Q } from '@shared/domain';
import { MATCH_DEFAULTS, type FrCurve } from '@shared/headphone';
import { correctionCurve, findPeaks } from '@shared/headphoneCorrection';
import { matchBands } from '@shared/headphoneMatch';

const RATE = 44_100;
const hz = Array.from({ length: 500 }, (_, point) => 20 * 1000 ** (point / 499));

/** Rolled off in the bass with a bump at 3 kHz and a narrow spike at 12 kHz, against a flat target. */
const measurement: FrCurve = {
  hz,
  db: hz.map(
    (at) =>
      -10 * Math.max(0, Math.log2(100 / at)) +
      5 * Math.exp(-((Math.log2(at / 3000) / 0.5) ** 2)) +
      8 * Math.exp(-((Math.log2(at / 12_000) / 0.05) ** 2)),
  ),
};
const flat: FrCurve = { hz, db: hz.map(() => 0) };

const match = (settings = {}, bassDb = 0) =>
  matchBands({
    measurement,
    target: flat,
    bassDb,
    maxBands: EQ_MAX_BANDS,
    settings: { ...MATCH_DEFAULTS, ...settings },
  });

const highest = (bands: ReturnType<typeof match>, low: number, high: number) => {
  let top = -Infinity;
  for (let at = low; at <= high; at *= 1.005) top = Math.max(top, curveDb(bands, at, RATE));
  return top;
};

describe('findPeaks', () => {
  it('gives the prominence and the width at half of it', () => {
    expect(findPeaks([0, 1, 3, 1, 0, 2, 0])).toEqual([
      { index: 2, prominence: 3, width: 1.5 },
      { index: 5, prominence: 2, width: 1 },
    ]);
  });

  it('takes a flat top once, and leaves the ends alone', () => {
    expect(findPeaks([5, 1, 2, 2, 2, 1, 5]).map(({ index }) => index)).toEqual([3]);
  });
});

describe('correctionCurve', () => {
  it('stops at the cap on boost, and takes the whole of a cut', () => {
    const { hz: at, db } = correctionCurve(measurement, flat);
    expect(Math.max(...db)).toBeLessThanOrEqual(6);
    const near3k = db[at.findIndex((point) => point >= 3000)] ?? 0;
    expect(near3k).toBeLessThan(-4);
  });
});

describe('matchBands', () => {
  it('fits within the app limits, as a low shelf, peaks and a high shelf', () => {
    const bands = match();
    expect(bands.length).toBeLessThanOrEqual(EQ_MAX_BANDS);
    for (const { gainDb, q } of bands) {
      expect(Math.abs(gainDb)).toBeLessThanOrEqual(EQ_MAX_GAIN_DB);
      expect(q).toBeGreaterThanOrEqual(EQ_MIN_Q);
      expect(q).toBeLessThanOrEqual(EQ_MAX_Q);
    }
    for (const { kind, frequencyHz } of bands) if (kind === 'peak') expect(frequencyHz).toBeLessThanOrEqual(10_000);
    expect(bands.map(({ id }) => id)).toEqual(bands.map((_, index) => index + 1));
  });

  it('lands on the correction where nothing limits it', () => {
    const bands = match();
    expect(curveDb(bands, 3000, RATE) - curveDb(bands, 500, RATE)).toBeCloseTo(-5, 0);
  });

  it('does not chase the narrow spike above 10 kHz', () => {
    expect(Math.abs(curveDb(match(), 12_000, RATE))).toBeLessThan(2);
  });

  it('gives the same answer every time', () => {
    expect(match()).toEqual(match());
  });

  it('holds a low limit under 100 Hz and leaves the rest alone', () => {
    const plain = match();
    const limited = match({ bassLimitDb: 2 });
    expect(highest(plain, 20, 100)).toBeGreaterThan(5);
    expect(highest(limited, 20, 100)).toBeLessThanOrEqual(2);
    for (const at of [1000, 3000, 8000]) {
      expect(Math.abs(curveDb(limited, at, RATE) - curveDb(plain, at, RATE))).toBeLessThan(0.3);
    }
  });

  it('corrects less of the low end when the seal varies', () => {
    expect(curveDb(match({ seal: 'varies' }), 70, RATE)).toBeLessThan(curveDb(match(), 70, RATE) - 0.5);
  });

  it('fades out above how high it was told to correct', () => {
    expect(Math.abs(curveDb(match({ correctUpToHz: 2000 }), 4000, RATE))).toBeLessThan(1);
    expect(Math.abs(curveDb(match(), 3000, RATE))).toBeGreaterThan(4);
  });

  it('raises the bass by what Bass says where the cap leaves room', () => {
    const plain = match({ bassLimitDb: 12 });
    const raised = match({ bassLimitDb: 12 }, 4);
    expect(curveDb(raised, 90, RATE) - curveDb(plain, 90, RATE)).toBeGreaterThan(1.5);
    expect(Math.abs(curveDb(raised, 2000, RATE) - curveDb(plain, 2000, RATE))).toBeLessThan(0.3);
  });
});
