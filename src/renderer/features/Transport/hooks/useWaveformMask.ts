import { useEffect, type RefObject } from 'react';
import { waveformBars } from '@/features/Transport/utils/waveformBars';

/** The mask stretches to fit in the meantime, so a window being dragged doesn't have to draw it every frame. */
const RESIZE_SETTLE_MS = 100;

function maskImage(peaks: Uint8Array, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) return 'none';
  for (const bar of waveformBars(peaks, width, height)) context.fillRect(bar.x, bar.y, bar.width, bar.height);
  // A data URL, because Chromium applies one as soon as it's set. A blob's would leave a gap between masks.
  return `url("${canvas.toDataURL()}")`;
}

/**
 * Draws the bars into `--waveform-mask` on the element, in its real device pixels. Bars as a mask, and not on a canvas of
 * their own, so they follow the accent's fade without being drawn again. The last mask stays when the peaks go, for the
 * bars to fade out with.
 */
export function useWaveformMask(elementRef: RefObject<HTMLElement | null>, peaks: Uint8Array | null): void {
  useEffect(() => {
    const element = elementRef.current;
    if (element === null || peaks === null) return;

    let hasDrawn = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Device pixels also change, with no change in CSS size, when the window moves to another screen.
    const observer = new ResizeObserver(([entry]) => {
      const size = entry?.devicePixelContentBoxSize[0];
      if (!size || size.inlineSize === 0 || size.blockSize === 0) return;
      const draw = () => {
        element.style.setProperty('--waveform-mask', maskImage(peaks, size.inlineSize, size.blockSize));
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
  }, [elementRef, peaks]);
}
