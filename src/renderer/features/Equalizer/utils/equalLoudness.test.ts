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

  it('needs far more level at the bottom, and flattens as it gets louder', () => {
    expect(splAt(40, 20)).toBeCloseTo(99.85, 0);
    expect(splAt(40, 20) - 40).toBeGreaterThan(splAt(80, 20) - 80);
  });

  it('dips near 3 to 4 kHz, where the ear is keenest', () => {
    expect(splAt(40, 3150)).toBeLessThan(40);
  });
});
