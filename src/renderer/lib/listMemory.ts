/* Where each list was: read when it mounts and written as it scrolls, so nothing re-renders for it. */

export type ListCell = {
  index: number;
  /** Which of the item's buttons: a row of album cards has several. */
  column: number;
};

type Memory = {
  top: number;
  focus: ListCell | null;
  /** What the sizes were when `top` was right, because a pixel means something else once they change. */
  layoutKey: string | null;
  total: number;
};

const NOTHING: Memory = { top: 0, focus: null, layoutKey: null, total: 0 };

/** How the next list to mount came to be showing: what had focus went away with the one it replaces. */
type Arrival = 'none' | 'drilled-in' | 'went-back' | 'left-search';

const memories = new Map<string, Memory>();
let arrival: Arrival = 'none';

export function recallList(key: string): Memory {
  return memories.get(key) ?? NOTHING;
}

export function rememberScroll(key: string, top: number): void {
  memories.set(key, { ...recallList(key), top });
}

export function rememberFocus(key: string, focus: ListCell): void {
  memories.set(key, { ...recallList(key), focus });
}

export function rememberLayout(key: string, layoutKey: string, total: number): void {
  memories.set(key, { ...recallList(key), layoutKey, total });
}

export function forgetList(key: string): void {
  memories.delete(key);
}

export function forgetAllLists(): void {
  memories.clear();
}

export function announceArrival(next: Arrival): void {
  arrival = next;
}

export function takeArrival(): Arrival {
  const next = arrival;
  arrival = 'none';
  return next;
}
