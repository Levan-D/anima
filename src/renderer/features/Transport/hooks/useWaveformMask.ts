import { useEffect, type RefObject } from 'react';
import type { WaveformData } from '@shared/domain';
import { waveformColumns, type WaveformColumn } from '@/features/Transport/utils/waveformColumns';

/** The mask stretches to fit in the meantime, so a window being dragged doesn't have to draw it every frame. */
const RESIZE_SETTLE_MS = 100;

function maskOf(
  columns: readonly WaveformColumn[],
  height: number,
  rectOf: (column: WaveformColumn) => [number, number],
): string {
  const canvas = document.createElement('canvas');
  canvas.width = columns.length;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) return 'none';
  columns.forEach((column, x) => {
    const [y, tall] = rectOf(column);
    if (tall > 0) context.fillRect(x, y, 1, tall);
  });
  // A data URL, because Chromium applies one as soon as it's set. A blob's would leave a gap between masks.
  return `url("${canvas.toDataURL()}")`;
}

/**
 * Draws the shape and its body into `--waveform-peaks` and `--waveform-rms` on the element, in its real device pixels. As
 * masks, and not on a canvas of their own, so they follow the accent's fade without being drawn again. The last masks stay
 * when the data goes, for the shape to fade out with.
 */
export function useWaveformMask(elementRef: RefObject<HTMLElement | null>, data: WaveformData | null): void {
  useEffect(() => {
    const element = elementRef.current;
    if (element === null || data === null) return;

    let hasDrawn = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Device pixels also change, with no change in CSS size, when the window moves to another screen.
    const observer = new ResizeObserver(([entry]) => {
      const size = entry?.devicePixelContentBoxSize[0];
      if (!size || size.inlineSize === 0 || size.blockSize === 0) return;
      const draw = () => {
        const columns = waveformColumns(data, size.inlineSize, size.blockSize);
        element.style.setProperty(
          '--waveform-peaks',
          maskOf(columns, size.blockSize, (c) => [c.peakY, c.peakHeight]),
        );
        element.style.setProperty(
          '--waveform-rms',
          maskOf(columns, size.blockSize, (c) => [c.rmsY, c.rmsHeight]),
        );
      };
      clearTimeout(timer);
      if (hasDrawn) {
        timer = setTimeout(draw, RESIZE_SETTLE_MS);
      } else {
        hasDrawn = true;
        draw();
      }
    });
    observer.observe(element, { box: 'device-pixel-content-box' });

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [elementRef, data]);
}
