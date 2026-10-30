import { useLayoutEffect, useRef, type RefObject } from 'react';
import { recallList, rememberLayout, rememberScroll } from '@/lib/listMemory';

/**
 * Row heights follow the window, so a resize changes what any given scroll position means. Scaling it by how much the
 * whole list changed keeps the same rows in view, and that holds across a change made while the list wasn't mounted,
 * because the memory says what the sizes were. Only a new `layoutKey` does this: a list that grew from a scan stays
 * exactly where it is. A null key means the sizes aren't known yet. A new `resetKey` means it's a different list now,
 * which starts from the top.
 */
export function useKeptScrollPosition(
  scrollerRef: RefObject<HTMLElement | null>,
  memoryKey: string,
  layoutKey: string | null,
  total: number,
  resetKey: string | null,
): void {
  const last = useRef({ layoutKey, total, resetKey });

  useLayoutEffect(() => {
    const previous = last.current;
    last.current = { layoutKey, total, resetKey };

    const scroller = scrollerRef.current;
    if (!scroller || layoutKey === null) return;

    if (previous.resetKey !== resetKey) {
      scroller.scrollTop = 0;
      rememberScroll(memoryKey, 0);
    } else if (previous.layoutKey !== layoutKey) {
      const saved = recallList(memoryKey);
      const before = previous.layoutKey === null ? saved : previous;
      const isSameLayout = before.layoutKey === null || before.layoutKey === layoutKey || before.total === 0;
      const next = isSameLayout ? saved.top : saved.top * (total / before.total);
      scroller.scrollTop = next;
      // Not left to the scroll event: one resize can change the layout twice before that arrives.
      rememberScroll(memoryKey, next);
    }
    rememberLayout(memoryKey, layoutKey, total);
  }, [layoutKey, memoryKey, resetKey, scrollerRef, total]);
}
