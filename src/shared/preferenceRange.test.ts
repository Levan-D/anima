import { describe, expect, it } from 'vitest';
import { PREFERENCE_RANGE, preferenceRangeFit } from '@shared/preferenceRange';

const on5128 = { family: 'bk5128', detail: 'Bruel & Kjaer 5128' } as const;

describe('PREFERENCE_RANGE', () => {
  const { hz, lowDb, highDb } = PREFERENCE_RANGE;

  it('has both edges at every frequency, in order, from 100 Hz to 10 kHz and no further', () => {
    expect(lowDb).toHaveLength(hz.length);
    expect(highDb).toHaveLength(hz.length);
    expect(hz.every((at, point) => point === 0 || at > (hz[point - 1] ?? 0))).toBe(true);
    expect(hz[0]).toBe(100);
    expect(hz.at(-1)).toBe(10_000);
  });

  it('never crosses itself', () => {
    expect(lowDb.every((low, point) => low <= (highDb[point] ?? Number.NEGATIVE_INFINITY))).toBe(true);
  });

  it('keeps its middle near 0, the alignment measurements are drawn with', () => {
    const inMiddle = hz.flatMap((at, point) =>
      at >= 300 && at <= 3000 ? [((lowDb[point] ?? 0) + (highDb[point] ?? 0)) / 2] : [],
    );
    const mean = inMiddle.reduce((sum, value) => sum + value, 0) / inMiddle.length;
    expect(Math.abs(mean)).toBeLessThan(1);
  });
});

describe('preferenceRangeFit', () => {
  it('fits an over-ear measured on a 5128', () => {
    expect(preferenceRangeFit({ rig: on5128, form: 'over-ear' })).toBe('fits');
  });

  it('refuses a GRAS measurement and an unknown rig, whatever the form', () => {
    expect(preferenceRangeFit({ rig: { family: 'iec711-pinna', detail: 'GRAS 43AG' }, form: 'over-ear' })).toBe('rig');
    expect(preferenceRangeFit({ rig: { family: 'unknown', detail: null }, form: 'over-ear' })).toBe('rig');
  });

  it('refuses an in-ear on a 5128, and a pair whose form nobody recorded', () => {
    expect(preferenceRangeFit({ rig: on5128, form: 'in-ear' })).toBe('form');
    expect(preferenceRangeFit({ rig: on5128, form: null })).toBe('form');
  });
});
