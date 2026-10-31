/** Bar and gap as parts of the height, so the bars grow with everything else. In whichever pixels it's given. */
const BAR_OF_HEIGHT = 1 / 12;
const GAP_OF_HEIGHT = 1 / 24;
/** Silence still draws, about as thick as the line the bars replace. */
const SHORTEST_OF_HEIGHT = 1 / 10;

export type Bar = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Bars from the middle out, each as tall as the loudest bucket it covers. */
export function waveformBars(peaks: Uint8Array, width: number, height: number): Bar[] {
  if (peaks.length === 0 || width <= 0 || height <= 0) return [];
  const barWidth = Math.max(1, Math.round(height * BAR_OF_HEIGHT));
  const pitch = barWidth + Math.max(1, Math.round(height * GAP_OF_HEIGHT));
  const count = Math.max(1, Math.floor((width + pitch - barWidth) / pitch));
  const shortest = Math.max(1, height * SHORTEST_OF_HEIGHT);

  return Array.from({ length: count }, (_, index) => {
    const from = Math.floor((index * peaks.length) / count);
    const to = Math.max(from + 1, Math.floor(((index + 1) * peaks.length) / count));
    const loudest = peaks.subarray(from, to).reduce((most, peak) => Math.max(most, peak), 0);
    const barHeight = Math.max(shortest, (loudest / 255) * height);
    return { x: index * pitch, y: (height - barHeight) / 2, width: barWidth, height: barHeight };
  });
}
