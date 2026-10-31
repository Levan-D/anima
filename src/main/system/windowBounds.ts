import type { WindowBounds, WindowPosition } from '@main/settings/settings';

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
const CORNER_MARGIN = 24;

function isReachable(window: Rect, area: Rect): boolean {
  const width = Math.min(window.x + window.width, area.x + area.width) - Math.max(window.x, area.x);
  const height = Math.min(window.y + window.height, area.y + area.height) - Math.max(window.y, area.y);
  return width >= Math.min(MIN_VISIBLE, window.width) && height >= Math.min(MIN_VISIBLE, window.height);
}

/** Where it was left if that's still on a display, and otherwise the primary display's bottom right corner. */
export function miniPlayerBounds(
  saved: WindowPosition | null,
  size: { width: number; height: number },
  workAreas: Rect[],
  primary: Rect,
): Rect {
  if (saved) {
    const bounds = { ...saved, ...size };
    if (workAreas.some((area) => isReachable(bounds, area))) return bounds;
  }
  return {
    x: primary.x + primary.width - size.width - CORNER_MARGIN,
    y: primary.y + primary.height - size.height - CORNER_MARGIN,
    ...size,
  };
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
