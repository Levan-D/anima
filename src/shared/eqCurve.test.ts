import { describe, expect, it } from 'vitest';
import type { EqBand } from '@shared/domain';
import { curveDb, isEqAudible, preampDb } from '@shared/eqCurve';

function band(overrides: Partial<EqBand> = {}): EqBand {
  return { id: 1, kind: 'peak', frequencyHz: 1000, gainDb: 6, q: 1, ...overrides };
}

describe('curveDb', () => {
  it('is flat with no bands, and for a band at 0 dB', () => {
    expect(curveDb([], 1000)).toBe(0);
    for (const kind of ['peak', 'lowshelf', 'highshelf'] as const) {
      expect(curveDb([band({ kind, gainDb: 0 })], 1000)).toBeCloseTo(0, 10);
    }
  });

  it('reaches a peak’s gain exactly at its frequency, either way', () => {
    expect(curveDb([band()], 1000)).toBeCloseTo(6, 10);
    expect(curveDb([band({ gainDb: -9 })], 1000)).toBeCloseTo(-9, 10);
  });

  it('dies away from a peak, and a wider Q reaches further', () => {
    expect(curveDb([band()], 20)).toBeCloseTo(0, 2);
    expect(curveDb([band()], 15_000)).toBeLessThan(0.2);
    expect(curveDb([band({ q: 0.3 })], 300)).toBeGreaterThan(curveDb([band({ q: 3 })], 300));
  });

  // RBJ's cookbook: halfway at the corner, and all of it at the far end.
  it('has a shelf at half its gain at the corner, and at all of it at the far end', () => {
    const low = band({ kind: 'lowshelf', frequencyHz: 200, q: 0.707 });
    expect(curveDb([low], 200)).toBeCloseTo(3, 1);
    expect(curveDb([low], 0)).toBeCloseTo(6, 10);
    expect(curveDb([low], 10_000)).toBeCloseTo(0, 2);

    const high = band({ kind: 'highshelf', frequencyHz: 5000, q: 0.707 });
    expect(curveDb([high], 5000)).toBeCloseTo(3, 1);
    expect(curveDb([high], 22_050)).toBeCloseTo(6, 10);
    expect(curveDb([high], 100)).toBeCloseTo(0, 2);
  });

  it('adds bands up in dB', () => {
    const a = band();
    const b = band({ id: 2, frequencyHz: 4000, gainDb: -3 });
    expect(curveDb([a, b], 2000)).toBeCloseTo(curveDb([a], 2000) + curveDb([b], 2000), 10);
  });

  it('bends towards Nyquist at the file’s own rate', () => {
    const high = band({ frequencyHz: 18_000, q: 2 });
    expect(curveDb([high], 18_000, 44_100)).toBeCloseTo(6, 10);
    expect(curveDb([high], 21_000, 44_100)).not.toBeCloseTo(curveDb([high], 21_000, 192_000), 1);
  });
});

describe('preampDb', () => {
  it('is nothing for no bands, and for cuts alone', () => {
    expect(preampDb([])).toBe(0);
    expect(preampDb([band({ gainDb: 0 })])).toBe(0);
    expect(preampDb([band({ gainDb: -6 })])).toBe(0);
  });

  it('is the negative of a single peak’s boost', () => {
    expect(preampDb([band()])).toBeCloseTo(-6, 2);
    expect(preampDb([band({ gainDb: 3.5 })])).toBeCloseTo(-3.5, 2);
  });

  it('finds where a shelf peaks, past the audible range', () => {
    expect(preampDb([band({ kind: 'highshelf', frequencyHz: 10_000, q: 0.707 })])).toBeCloseTo(-6, 2);
    expect(preampDb([band({ kind: 'lowshelf', frequencyHz: 80, q: 0.707 })])).toBeCloseTo(-6, 2);
  });

  it('allows for bands that stack, and for a cut that takes some of it back', () => {
    const stacked = [band(), band({ id: 2 })];
    expect(preampDb(stacked)).toBeCloseTo(-12, 2);
    expect(preampDb([band(), band({ id: 2, gainDb: -6 })])).toBeCloseTo(0, 1);
  });

  it('leaves the curve at or under 0 dB everywhere, at every rate', () => {
    const bands = [
      band({ kind: 'lowshelf', frequencyHz: 90, gainDb: 8, q: 0.7 }),
      band({ id: 2, frequencyHz: 120, gainDb: 5, q: 0.8 }),
      band({ id: 3, frequencyHz: 3100, gainDb: -7, q: 2 }),
      band({ id: 4, frequencyHz: 16_000, gainDb: 9, q: 1.5 }),
      band({ id: 5, kind: 'highshelf', frequencyHz: 12_000, gainDb: 4, q: 0.7 }),
    ];
    const preamp = preampDb(bands);
    for (const rate of [44_100, 48_000, 96_000, 192_000]) {
      for (let hz = 5; hz < rate / 2; hz *= 1.003) {
        expect(curveDb(bands, hz, rate) + preamp).toBeLessThanOrEqual(0.001);
      }
    }
  });
});

describe('isEqAudible', () => {
  it('takes being on and a band that does something', () => {
    expect(isEqAudible({ enabled: true, bands: [band()] })).toBe(true);
    expect(isEqAudible({ enabled: false, bands: [band()] })).toBe(false);
    expect(isEqAudible({ enabled: true, bands: [band({ gainDb: 0 })] })).toBe(false);
    expect(isEqAudible({ enabled: true, bands: [] })).toBe(false);
  });
});
