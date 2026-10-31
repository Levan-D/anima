import { describe, expect, it } from 'vitest';
import { waveformColumns } from '@/features/Transport/utils/waveformColumns';

const levels = (peaks: number[], rms: number[] = peaks.map((peak) => peak / 2)) => ({
  peaks: Uint8Array.from(peaks),
  rms: Uint8Array.from(rms),
});

describe('waveformColumns', () => {
  it('gives one column for every pixel, with no gaps, whichever has more', () => {
    expect(waveformColumns(levels(Array(2000).fill(100) as number[]), 963, 50)).toHaveLength(963);
    expect(waveformColumns(levels([100, 200]), 7, 50)).toHaveLength(7);
  });

  it('mirrors around the center', () => {
    const [column] = waveformColumns(levels([255], [127]), 1, 50);
    expect(column).toEqual({ peakY: 0, peakHeight: 50, rmsY: 12, rmsHeight: 25 });
  });

  it('draws silence as a line one pixel thick, with no body', () => {
    const [column] = waveformColumns(levels([0], [0]), 1, 51);
    expect(column).toEqual({ peakY: 25, peakHeight: 1, rmsY: 25, rmsHeight: 0 });
  });

  it('keeps the loudest peak of the buckets in a column', () => {
    const [column] = waveformColumns(levels([10, 255, 10, 10], [10, 10, 10, 10]), 1, 100);
    expect(column?.peakHeight).toBe(100);
  });

  it('averages the RMS of the buckets in a column by power', () => {
    const [column] = waveformColumns(levels([255, 255], [255, 0]), 1, 100);
    expect(column?.rmsHeight).toBe(71);
  });

  it('takes the later bucket for the later column', () => {
    const columns = waveformColumns(levels([0, 255], [0, 100]), 4, 10);
    expect(columns.map(({ peakHeight }) => peakHeight)).toEqual([1, 1, 10, 10]);
  });

  it('never lets the body out of the shape', () => {
    const [column] = waveformColumns(levels([10], [200]), 1, 100);
    expect(column?.rmsHeight).toBe(column?.peakHeight);
  });

  it('has nothing to draw with nothing to draw it in', () => {
    expect(waveformColumns(levels([]), 100, 50)).toEqual([]);
    expect(waveformColumns(levels([1]), 0, 50)).toEqual([]);
    expect(waveformColumns(levels([1]), 100, 0)).toEqual([]);
  });
});
