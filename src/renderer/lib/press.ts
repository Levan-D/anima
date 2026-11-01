import type { MouseEvent } from 'react';

export function isMousePress(event: MouseEvent): boolean {
  return (event.nativeEvent as PointerEvent).pointerType === 'mouse';
}

/** A mouse selects with one click and plays with two. A finger has no second click to give, and a key press has no first. */
export function pressMeansPlay(event: MouseEvent): boolean {
  return isMousePress(event) ? event.detail === 2 : event.detail <= 1;
}
