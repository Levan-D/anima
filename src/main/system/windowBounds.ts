import type { WindowBounds } from '@main/settings/settings';

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type InitialBounds = {
  x?: number;
  y?: number;
  width: number;
  height: number;
};

const DEFAULT_WIDTH = 1440;
const DEFAULT_HEIGHT = 900;
/** Enough of the window to grab and pull back. */
const MIN_VISIBLE = 100;

function isReachable(window: Rect, area: Rect): boolean {
  const width = Math.min(window.x + window.width, area.x + area.width) - Math.max(window.x, area.x);
  const height = Math.min(window.y + window.height, area.y + area.height) - Math.max(window.y, area.y);
  return width >= MIN_VISIBLE && height >= MIN_VISIBLE;
}

/**
 * The TV may be unplugged since last time, so saved bounds only count on a display that's still there.
 * It's the shrunk window that has to reach it: shrinking can pull a window off the part that overlapped.
 */
export function initialBounds(saved: WindowBounds | null, workAreas: Rect[], primary: Rect): InitialBounds {
  if (saved) {
    for (const area of workAreas) {
      const fitted = {
        x: saved.x,
        y: saved.y,
        width: Math.min(saved.width, area.width),
        height: Math.min(saved.height, area.height),
      };
      if (isReachable(fitted, area)) return fitted;
    }
  }

  return { width: Math.min(DEFAULT_WIDTH, primary.width), height: Math.min(DEFAULT_HEIGHT, primary.height) };
}
