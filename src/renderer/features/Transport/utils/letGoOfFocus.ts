import type { PointerEvent } from 'react';

/**
 * A press leaves focus on what was pressed, and the next key of any kind, a hotkey included, then turns its ring on. The
 * transport is pressed and left alone, so it hands focus back. Only what's still inside: a menu it opened keeps its own.
 */
export function letGoOfFocus({ currentTarget }: PointerEvent<HTMLElement>): void {
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && currentTarget.contains(focused)) focused.blur();
}
