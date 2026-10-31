import type { WaveformData } from '@shared/domain';

const TOP = 255;

export type WaveformColumn = {
  /** The whole shape in this column: the loudest moment, mirrored around the center. Never less than a pixel. */
  peakY: number;
  peakHeight: number;
  /** The body inside it: how loud it is on average. Zero when there's none. */
  rmsY: number;
  rmsHeight: number;
};

function bucketsOf(column: number, width: number, buckets: number): [number, number] {
  const from = Math.floor((column * buckets) / width);
  return [from, Math.max(from + 1, Math.floor(((column + 1) * buckets) / width))];
}

/** One for each pixel across, in whichever pixels it's given. Several buckets to a column keep the top peak, and an average of the RMS by power. */
export function waveformColumns({ peaks, rms }: WaveformData, width: number, height: number): WaveformColumn[] {
  if (peaks.length === 0 || width <= 0 || height <= 0) return [];

  return Array.from({ length: width }, (_, column) => {
    const [from, to] = bucketsOf(column, width, peaks.length);
    const peak = peaks.subarray(from, to).reduce((most, level) => Math.max(most, level), 0);
    const power = rms.subarray(from, to).reduce((total, level) => total + level * level, 0) / (to - from);

    const peakHeight = Math.max(1, Math.round((peak / TOP) * height));
    const rmsHeight = Math.min(peakHeight, Math.round((Math.sqrt(power) / TOP) * height));
    return {
      peakY: Math.floor((height - peakHeight) / 2),
      peakHeight,
      rmsY: Math.floor((height - rmsHeight) / 2),
      rmsHeight,
    };
  });
}
