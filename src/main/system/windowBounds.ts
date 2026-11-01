import type { MiniQueueSide } from '@shared/domain';
import type { WindowBounds, WindowPosition } from '@main/settings/settings';

export type Rect = {
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

/** Where it was left if that's still on a display, kept whole on it, and otherwise the primary display's bottom right corner. */
export function miniPlayerBounds(
  saved: WindowPosition | null,
  size: { width: number; height: number },
  workAreas: Rect[],
  primary: Rect,
): Rect {
  if (saved) {
    const bounds = { ...saved, ...size };
    const area = workAreas.find((candidate) => isReachable(bounds, candidate));
    if (area) return { ...bounds, x: Math.max(Math.min(saved.x, area.x + area.width - size.width), area.x) };
  }
  return {
    x: primary.x + primary.width - size.width - CORNER_MARGIN,
    y: primary.y + primary.height - size.height - CORNER_MARGIN,
    ...size,
  };
}

/** The mini grown to show the queue: downward unless there's more room above, and never past the work area. */
export function miniQueueBounds(strip: Rect, queueHeight: number, area: Rect): { bounds: Rect; side: MiniQueueSide } {
  const below = area.y + area.height - (strip.y + strip.height);
  const above = strip.y - area.y;
  if (below >= queueHeight || below >= above) {
    return { side: 'below', bounds: { ...strip, height: strip.height + Math.max(Math.min(queueHeight, below), 0) } };
  }
  const grown = Math.max(Math.min(queueHeight, above), 0);
  return { side: 'above', bounds: { ...strip, y: strip.y - grown, height: strip.height + grown } };
}

/** The strip inside a grown window, which stays at the edge the queue grew away from. It's what the position remembers. */
export function stripWithin(window: Rect, strip: Rect, side: MiniQueueSide | null): Rect {
  const y = side === 'above' ? window.y + window.height - strip.height : window.y;
  return { ...strip, x: window.x, y };
}

/** Rounded, because Electron refuses fractions. `progress` eases in and out, so the first step barely moves. */
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
