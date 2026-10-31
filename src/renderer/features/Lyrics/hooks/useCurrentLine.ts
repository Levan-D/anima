import { useMemo, type RefObject } from 'react';
import { lineAt, type LyricRow } from '@/features/Lyrics/utils/timeline';
import { motionDuration } from '@/lib/motionTokens';
import { PAINT_EVERY_MS, usePlayerPosition, type PositionPainter } from '@/lib/playerPosition';

function rowElement(scroller: HTMLElement, index: number): HTMLElement | null {
  return scroller.querySelector<HTMLElement>(`[data-line="${index}"]`);
}

function keepInPlace(scroller: HTMLElement, row: HTMLElement, isFirst: boolean): void {
  scroller.scrollTo({
    top: row.offsetTop + row.offsetHeight / 2 - scroller.clientHeight / 2,
    behavior: isFirst || motionDuration('--dur-mid') === 0 ? 'auto' : 'smooth',
  });
}

function linePainter(rows: LyricRow[], offsetMs: number, scrollerRef: RefObject<HTMLElement | null>): PositionPainter {
  let shownIndex: number | null = null;
  let shownLit: number | null = null;

  return (positionMs) => {
    const scroller = scrollerRef.current;
    if (scroller === null) return Infinity;
    const { index, isLit, changesInMs } = lineAt(rows, positionMs - offsetMs);
    const row = rowElement(scroller, index);

    if (row !== null && index !== shownIndex) {
      keepInPlace(scroller, row, shownIndex === null);
      shownIndex = index;
    }
    const lit = isLit ? index : null;
    if (lit !== shownLit || (shownLit === null && scroller.querySelector('[aria-current]') !== null)) {
      scroller.querySelector('[aria-current]')?.removeAttribute('aria-current');
      if (lit !== null) row?.setAttribute('aria-current', 'true');
      shownLit = lit;
    }
    return Math.max(changesInMs, PAINT_EVERY_MS);
  };
}

/** Writes straight to the DOM, so the lines don't re-render with the music. */
export function useCurrentLine(rows: LyricRow[], offsetMs: number, scroller: RefObject<HTMLElement | null>): void {
  const painter = useMemo(() => linePainter(rows, offsetMs, scroller), [rows, offsetMs, scroller]);
  usePlayerPosition(painter);
}
