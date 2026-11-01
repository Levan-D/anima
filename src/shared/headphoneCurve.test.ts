/* Curves here are made up on the spot. No third party's numbers belong in this repo. */

import { describe, expect, it } from 'vitest';
import type { EqBand, EqSettings } from '@shared/domain';
import { curveDb, effectivePreampDb } from '@shared/eqCurve';
import type { FrCurve, RigTag } from '@shared/headphone';
import {
  alignmentDb,
  canCompare,
  differenceLine,
  eqLevelDb,
  matchedOff,
  measuredLine,
  plotRangeDb,
  predictedLine,
  rigMatch,
  smooth,
  targetLine,
  valueAt,
} from './headphoneCurve';

/** Evenly along a log axis from 20 Hz to 20 kHz, with the shape given. */
function madeUp(shape: (hz: number) => number, points = 400): FrCurve {
  const hz = Array.from({ length: points }, (_, point) => 20 * 1000 ** (point / (points - 1)));
  return { hz, db: hz.map(shape) };
}

const band = (over: Partial<EqBand> = {}): EqBand => ({
  id: 1,
  kind: 'peak',
  frequencyHz: 1000,
  gainDb: 6,
  q: 1,
  ...over,
});
const eq = (bands: EqBand[], over: Partial<EqSettings> = {}): EqSettings => ({
  enabled: true,
  bands,
  preamp: { auto: true, db: 0 },
  ...over,
});

const rig = (family: RigTag['family'], detail: string | null = null): RigTag => ({ family, detail });

describe('valueAt', () => {
  const curve = { hz: [100, 1000, 10_000], db: [0, 10, 0] };

  it('goes straight between points on a log axis', () => {
    expect(valueAt(curve, Math.sqrt(100 * 1000))).toBeCloseTo(5, 9);
  });

  it('lands on the points themselves', () => {
    expect(valueAt(curve, 100)).toBe(0);
    expect(valueAt(curve, 10_000)).toBe(0);
  });

  it('says nothing outside what it covers', () => {
    expect(valueAt(curve, 99)).toBeNull();
    expect(valueAt(curve, 10_001)).toBeNull();
  });
});

describe('smooth', () => {
  it('leaves a level line level', () => {
    const { db } = smooth(madeUp(() => 7));
    expect(Math.max(...db)).toBeCloseTo(7, 9);
    expect(Math.min(...db)).toBeCloseTo(7, 9);
  });

  it('leaves a steady slope exactly on itself, ends included', () => {
    const slope = madeUp((hz) => 3 * Math.log2(hz));
    const { hz, db } = smooth(slope);
    for (const [point, at] of hz.entries()) expect(db[point]).toBeCloseTo(3 * Math.log2(at), 6);
  });

  it('takes down a peak narrower than the window, and leaves a broad one nearly alone', () => {
    const peak = (width: number) => (hz: number) => 10 * Math.exp(-((Math.log2(hz / 1000) / width) ** 2));
    const narrow = smooth(madeUp(peak(1 / 48), 4000));
    const broad = smooth(madeUp(peak(1), 4000));
    expect(valueAt(narrow, 1000)).toBeLessThan(6);
    expect(valueAt(broad, 1000)).toBeGreaterThan(9.9);
  });

  it('turns a single-point spike into its height over the window, so its width is 1/12 octave', () => {
    const hz = Array.from({ length: 961 }, (_, point) => 20 * 2 ** (point / 96));
    const db = hz.map((_, point) => (point === 480 ? 9 : 0));
    const smoothed = smooth({ hz, db });
    expect(Math.max(...smoothed.db)).toBeCloseTo(1, 6);
    expect(smoothed.db.filter((value) => value > 0)).toHaveLength(9);
  });

  it('has nothing to do on nothing', () => {
    expect(smooth({ hz: [], db: [] })).toEqual({ hz: [], db: [] });
  });
});

describe('alignmentDb', () => {
  it('moves the mean of 300 Hz to 3 kHz to 0', () => {
    const curve = madeUp((hz) => 80 + 2 * Math.sin(Math.log2(hz) * 3));
    const aligned = measuredLine(curve, false);
    const inBand = aligned.db.filter((_, point) => {
      const at = aligned.hz[point] ?? 0;
      return at >= 300 && at <= 3000;
    });
    expect(inBand.reduce((sum, value) => sum + value, 0) / inBand.length).toBeCloseTo(0, 6);
  });

  it("isn't moved by what's outside the band", () => {
    const flat = madeUp(() => 70);
    const wild = madeUp((hz) => (hz > 280 && hz < 3200 ? 70 : 70 + 15 * Math.sign(1000 - hz)));
    expect(alignmentDb(wild)).toBeCloseTo(alignmentDb(flat), 6);
  });

  it("isn't thrown by a notch at 1 kHz, as a single point would be", () => {
    const notched = madeUp((hz) => 70 - 12 * Math.exp(-((Math.log2(hz / 1000) / 0.08) ** 2)));
    expect(alignmentDb(notched) + 70).toBeLessThan(1);
  });
});

describe('measuredLine', () => {
  const curve = madeUp((hz) => 75 + 3 * Math.sin(Math.log2(hz) * 8));

  it('stays in the same place between smoothed and raw', () => {
    const smoothedLine = measuredLine(curve, false);
    const rawLine = measuredLine(curve, true);
    expect(valueAt(rawLine, 1000)).toBeCloseTo(valueAt(smoothedLine, 1000) ?? 0, 0);
  });

  it('keeps the points of a raw file as they came', () => {
    const { hz } = measuredLine(curve, true);
    expect(hz).toEqual(curve.hz);
  });

  it('thins a file with far more points than pixels, without moving it', () => {
    const dense = madeUp((at) => 2 * Math.log2(at), 20_000);
    const { hz, db } = measuredLine(dense, true);
    expect(hz.length).toBeLessThanOrEqual(1600);
    const by = alignmentDb(dense);
    expect(db[800]).toBeCloseTo(2 * Math.log2(hz[800] ?? 0) + by, 2);
  });
});

describe('predictedLine', () => {
  const bands = [
    band({ gainDb: -4, frequencyHz: 3000, q: 2 }),
    band({ id: 2, kind: 'lowshelf', frequencyHz: 100, gainDb: 5, q: 0.7 }),
  ];
  const measured = measuredLine(
    madeUp((hz) => 3 * Math.sin(Math.log2(hz))),
    false,
  );

  it('is exactly measured plus the curve at this rate, at every point', () => {
    for (const rate of [44_100, 96_000]) {
      const predicted = predictedLine(measured, bands, rate);
      for (const [point, at] of predicted.hz.entries()) {
        expect(predicted.db[point]).toBeCloseTo((measured.db[point] ?? 0) + curveDb(bands, at, rate), 9);
      }
    }
  });

  it("differs by rate where the real filters do, so it isn't drawn at one rate for every file", () => {
    const high = [band({ kind: 'highshelf', frequencyHz: 10_000, gainDb: 6, q: 0.7 })];
    const at44 = predictedLine(measured, high, 44_100);
    const at96 = predictedLine(measured, high, 96_000);
    const gap = (valueAt(at96, 18_000) ?? 0) - (valueAt(at44, 18_000) ?? 0);
    expect(Math.abs(gap)).toBeGreaterThan(0.05);
  });

  it('stops at the Nyquist of a low-rate file', () => {
    const predicted = predictedLine(measured, bands, 22_050);
    expect(predicted.hz.at(-1)).toBeLessThanOrEqual(11_025);
    expect(predicted.hz.length).toBeLessThan(measured.hz.length);
  });

  it('has the same smoothing as measured: with no EQ it is measured', () => {
    const predicted = predictedLine(measured, [], 44_100);
    expect(predicted.db).toEqual(measured.db);
  });

  it('ignores the preamp, which moves the sound and not the shape', () => {
    const on = predictedLine(measured, bands, 44_100);
    expect(on.db[100]).toBeCloseTo((measured.db[100] ?? 0) + curveDb(bands, on.hz[100] ?? 0, 44_100), 9);
  });
});

describe('targetLine', () => {
  const curve = madeUp((hz) => 90 - 2 * Math.log2(hz));

  it('is aligned by the same rule as a measurement', () => {
    expect(valueAt(targetLine(curve, 0), 1000)).toBeCloseTo(valueAt(measuredLine(curve, false), 1000) ?? 0, 6);
  });

  it('adds a shelf for bass, low down, and leaves the rest', () => {
    const plain = targetLine(curve, 0);
    const more = targetLine(curve, 6);
    expect((valueAt(more, 20) ?? 0) - (valueAt(plain, 20) ?? 0)).toBeGreaterThan(5.5);
    expect((valueAt(more, 3000) ?? 0) - (valueAt(plain, 3000) ?? 0)).toBeLessThan(0.05);
  });

  it('takes bass away too', () => {
    expect((valueAt(targetLine(curve, -2), 20) ?? 0) - (valueAt(targetLine(curve, 0), 20) ?? 0)).toBeLessThan(-1.8);
  });
});

describe('differenceLine', () => {
  it('is 0 where a line is on the target', () => {
    const target = madeUp((hz) => Math.log2(hz));
    const { db } = differenceLine(target, target);
    expect(Math.max(...db.map(Math.abs))).toBeLessThan(1e-9);
  });

  it('only covers what both cover', () => {
    const line = { hz: [10, 100, 1000], db: [1, 2, 3] };
    const target = { hz: [50, 2000], db: [0, 0] };
    expect(differenceLine(line, target).hz).toEqual([100, 1000]);
  });
});

describe('rigMatch', () => {
  const target = (r: RigTag, isTranslated = false) => ({ rig: r, isTranslated });

  it('is defined only on exactly the same rig', () => {
    expect(rigMatch(rig('bk5128', 'Bruel & Kjaer 5128'), target(rig('bk5128', 'bruel & kjaer 5128')))).toBe('defined');
  });

  it('is approximate within a family', () => {
    expect(rigMatch(rig('iec711-pinna', 'GRAS 43AG'), target(rig('iec711-pinna', 'GRAS 45CA')))).toBe('approximate');
    expect(rigMatch(rig('iec711-pinna'), target(rig('iec711-pinna')))).toBe('approximate');
  });

  it('is approximate on a target someone translated, whatever the rig says', () => {
    expect(rigMatch(rig('hms', 'HMS II.3'), target(rig('hms', 'HMS II.3'), true))).toBe('approximate');
  });

  it('is different across families', () => {
    expect(rigMatch(rig('bk5128', 'Bruel & Kjaer 5128'), target(rig('iec711-pinna', 'GRAS 45CA')))).toBe('different');
  });

  it("can't say with an unknown rig on either side", () => {
    expect(rigMatch(rig('unknown'), target(rig('bk5128')))).toBe('unknown');
    expect(rigMatch(rig('bk5128'), target(rig('unknown')))).toBe('unknown');
  });
});

describe('plotRangeDb', () => {
  it('has room for a line that goes wide, in whole steps', () => {
    expect(plotRangeDb([madeUp((hz) => (hz < 100 ? -19 : 0))])).toBe(24);
  });

  it("has a floor, so a modest line doesn't squeeze the scale", () => {
    expect(plotRangeDb([madeUp(() => 2)])).toBe(18);
  });

  it("isn't pushed out by the treble above 10 kHz, which it hardly trusts", () => {
    expect(plotRangeDb([madeUp((hz) => (hz > 11_000 ? -60 : 0))])).toBe(18);
  });

  it('has a ceiling, so a wild file leaves nodes usable', () => {
    expect(plotRangeDb([madeUp(() => 90)])).toBe(36);
  });
});

describe('the level match', () => {
  const shape = eq([
    band({ kind: 'lowshelf', frequencyHz: 105, gainDb: 6, q: 0.7 }),
    band({ id: 2, frequencyHz: 3000, gainDb: -5, q: 1.4 }),
  ]);

  it('comes to the power mean of curve and preamp', () => {
    const preamp = effectivePreampDb(shape);
    const level = eqLevelDb(shape, 44_100);
    expect(level).toBeLessThan(curveDb(shape.bands, 100, 44_100) + preamp);
    expect(level).toBeGreaterThan(preamp + curveDb(shape.bands, 3000, 44_100));
  });

  it('is the preamp alone for a flat curve', () => {
    const flat = eq([band({ gainDb: 0 })], { preamp: { auto: false, db: -3 } });
    expect(eqLevelDb(flat, 44_100)).toBeCloseTo(-3, 9);
  });

  it('keeps every band at flat, in the same order, so the chain only moves values', () => {
    const { eq: off, gainDb } = matchedOff(shape, 44_100);
    expect(off.bands.map(({ kind, frequencyHz, q }) => ({ kind, frequencyHz, q }))).toEqual(
      shape.bands.map(({ kind, frequencyHz, q }) => ({ kind, frequencyHz, q })),
    );
    expect(off.bands.every((one) => one.gainDb === 0)).toBe(true);
    expect(off.preamp).toEqual({ auto: false, db: gainDb });
    expect(off.enabled).toBe(true);
  });

  it('does nothing at all to the signal but its gain', () => {
    const { eq: off } = matchedOff(shape, 44_100);
    expect(curveDb(off.bands, 100, 44_100)).toBeCloseTo(0, 9);
    expect(curveDb(off.bands, 3000, 44_100)).toBeCloseTo(0, 9);
  });

  it('never takes the off side above the file, and says how far short that leaves it', () => {
    const loud = eq([band({ gainDb: 6, q: 0.2 })], { preamp: { auto: false, db: 6 } });
    const { gainDb, shortByDb } = matchedOff(loud, 44_100);
    expect(gainDb).toBe(0);
    expect(shortByDb).toBeGreaterThan(6);
  });

  it('only offers a comparison with a curve to compare', () => {
    expect(canCompare(shape)).toBe(true);
    expect(canCompare({ ...shape, enabled: false })).toBe(false);
    expect(canCompare(eq([band({ gainDb: 0 })]))).toBe(false);
    expect(canCompare(eq([band({ gainDb: 0 })], { preamp: { auto: false, db: -3 } }))).toBe(false);
  });
});
