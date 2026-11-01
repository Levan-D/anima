import { describe, expect, it } from 'vitest';
import { equalLoudnessContour } from '@/features/Equalizer/utils/equalLoudness';

function splAt(phon: number, hz: number): number {
  return equalLoudnessContour(phon).find((point) => point.hz === hz)?.splDb ?? Number.NaN;
}

describe('ISO 226:2003 contours', () => {
  it('equals the phon value at 1 kHz', () => {
    expect(splAt(40, 1000)).toBeCloseTo(40, 0);
    expect(splAt(80, 1000)).toBeCloseTo(80, 0);
  });

  // The 60 phon contour printed by another implementation of the standard, https://gist.github.com/sammosummo/777debf946d0356acada
  it('matches a published contour', () => {
    expect(splAt(60, 20)).toBeCloseTo(109.51, 2);
    expect(splAt(60, 100)).toBeCloseTo(78.65, 2);
    expect(splAt(60, 3150)).toBeCloseTo(56.42, 2);
    expect(splAt(60, 12_500)).toBeCloseTo(68.63, 2);
  });

  it('needs far more level at the bottom, and flattens as it gets louder', () => {
    expect(splAt(40, 20)).toBeCloseTo(99.85, 0);
    expect(splAt(40, 20) - 40).toBeGreaterThan(splAt(80, 20) - 80);
  });

  it('dips near 3 to 4 kHz, where the ear is keenest', () => {
    expect(splAt(40, 3150)).toBeLessThan(40);
  });
});
