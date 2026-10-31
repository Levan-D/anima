/** Of the art's width. A flick across a quarter of it is meant, and a thumb resting on it isn't. */
const THRESHOLD = 0.2;
/** It has to be this much more sideways than up or down. */
const SIDEWAYS = 1.5;

export function isSideways(dx: number, dy: number): boolean {
  return Math.abs(dx) > Math.abs(dy) * SIDEWAYS;
}

/** Dragging the art left brings the next one in, as turning a page does. */
export function swipeAction(dx: number, dy: number, width: number): 'next' | 'previous' | null {
  if (!isSideways(dx, dy) || Math.abs(dx) < width * THRESHOLD) return null;
  return dx < 0 ? 'next' : 'previous';
}
