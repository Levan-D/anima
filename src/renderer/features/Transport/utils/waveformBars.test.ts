import { describe, expect, it } from 'vitest';
import { waveformBars } from '@/features/Transport/utils/waveformBars';

describe('waveformBars', () => {
  it('fills the width without going over, at any size', () => {
    for (const [width, height] of [
      [400, 25],
      [1500, 50],
      [7000, 120],
    ] as const) {
      const bars = waveformBars(new Uint8Array(2000).fill(255), width, height);
      const last = bars.at(-1);
      expect(last && last.x + last.width).toBeLessThanOrEqual(width);
      expect(bars.length).toBeGreaterThan(10);
    }
  });

  it('centers the bars and goes by the loudest bucket each one covers', () => {
    const peaks = new Uint8Array(100);
    peaks[3] = 255;
    const [first, second] = waveformBars(peaks, 3 * 10 - 1, 24);
    expect(first).toMatchObject({ y: 0, height: 24 });
    expect(second?.height).toBeLessThan(5);
    expect((second?.y ?? 0) * 2 + (second?.height ?? 0)).toBe(24);
  });

  it('still draws silence, and handles more bars than buckets', () => {
    const quiet = waveformBars(new Uint8Array(4), 600, 24);
    expect(quiet.length).toBeGreaterThan(4);
    expect(quiet.every(({ height }) => height > 0)).toBe(true);
  });

  it('has nothing to draw with no peaks or no room', () => {
    expect(waveformBars(new Uint8Array(0), 100, 24)).toEqual([]);
    expect(waveformBars(new Uint8Array(4), 0, 24)).toEqual([]);
  });
});
