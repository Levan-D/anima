import { describe, expect, it } from 'vitest';
import { EQ_AUTO_PREAMP, type EqBand } from '@shared/domain';
import { clipDb, curveDb as curveAtRate, effectivePreampDb, isBandActive, isEqAudible, preampDb } from '@shared/eqCurve';

const curveDb = (bands: readonly EqBand[], hz: number, rate = 44_100) => curveAtRate(bands, hz, rate);

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

describe('a band above a file’s Nyquist', () => {
  const high = band({ frequencyHz: 20_000, gainDb: 6, q: 1 });
  const low = band({ id: 2, kind: 'lowshelf', frequencyHz: 100, gainDb: 3, q: 0.707 });

  it('is inactive above Nyquist, and still active at it', () => {
    expect(isBandActive(high, 32_000)).toBe(false);
    expect(isBandActive(high, 40_000)).toBe(true);
    expect(isBandActive(high, 44_100)).toBe(true);
  });

  it('adds nothing to the curve, whatever kind it is', () => {
    expect(curveDb([high], 5000, 32_000)).toBe(0);
    expect(curveDb([{ ...high, kind: 'lowshelf' }], 5000, 32_000)).toBe(0);
    expect(curveDb([{ ...high, kind: 'highshelf' }], 15_000, 32_000)).toBe(0);
    expect(curveDb([high, low], 50, 32_000)).toBeCloseTo(curveDb([low], 50, 32_000), 10);
  });

  it('on Nyquist exactly, is a low shelf’s gain everywhere and nothing for the others', () => {
    const atNyquist = band({ frequencyHz: 16_000, gainDb: 6, q: 1 });
    for (const hz of [100, 5000, 16_000]) {
      expect(curveDb([atNyquist], hz, 32_000)).toBe(0);
      expect(curveDb([{ ...atNyquist, kind: 'highshelf' }], hz, 32_000)).toBe(0);
      expect(curveDb([{ ...atNyquist, kind: 'lowshelf' }], hz, 32_000)).toBe(6);
    }
  });

  it('has a curve that stops at Nyquist, instead of folding back', () => {
    expect(curveDb([low], 30_000, 32_000)).toBeCloseTo(curveDb([low], 16_000, 32_000), 10);
  });

  it('still counts in the headroom, at the rates where it is active', () => {
    expect(preampDb([high])).toBeCloseTo(-6, 2);
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
    const preamp = EQ_AUTO_PREAMP;
    expect(isEqAudible({ enabled: true, bands: [band()], preamp })).toBe(true);
    expect(isEqAudible({ enabled: false, bands: [band()], preamp })).toBe(false);
    expect(isEqAudible({ enabled: true, bands: [band({ gainDb: 0 })], preamp })).toBe(false);
    expect(isEqAudible({ enabled: true, bands: [], preamp })).toBe(false);
  });

  it('counts a preamp set by hand, even over flat bands', () => {
    expect(isEqAudible({ enabled: true, bands: [], preamp: { auto: false, db: -3 } })).toBe(true);
    expect(isEqAudible({ enabled: true, bands: [], preamp: { auto: false, db: 0 } })).toBe(false);
  });
});

describe('the preamp in use', () => {
  const bands = [band()];

  it('is the automatic headroom, or the value set by hand', () => {
    expect(effectivePreampDb({ bands, preamp: EQ_AUTO_PREAMP })).toBeCloseTo(-6, 2);
    expect(effectivePreampDb({ bands, preamp: { auto: false, db: 2 } })).toBe(2);
  });

  it('says how far the peak passes full scale, only by hand', () => {
    expect(clipDb({ bands, preamp: EQ_AUTO_PREAMP })).toBe(0);
    expect(clipDb({ bands, preamp: { auto: false, db: -6 } })).toBe(0);
    expect(clipDb({ bands, preamp: { auto: false, db: -3 } })).toBeCloseTo(3, 1);
    expect(clipDb({ bands: [], preamp: { auto: false, db: 2 } })).toBe(2);
  });
});
