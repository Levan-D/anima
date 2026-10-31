import { useCallback, useRef } from 'react';
import { PAINT_EVERY_MS, usePlayerPosition, type PositionPainter } from '@/lib/playerPosition';

/** Written straight to the DOM, and only as often as the line would move a whole pixel. */
export function MiniProgress() {
  const lineRef = useRef<HTMLDivElement>(null);

  const painter = useCallback<PositionPainter>((positionMs, durationMs) => {
    const line = lineRef.current;
    if (!line) return Infinity;
    line.style.setProperty('--progress', String(durationMs > 0 ? positionMs / durationMs : 0));
    return Math.max(PAINT_EVERY_MS, durationMs / Math.max(line.clientWidth, 1));
  }, []);
  usePlayerPosition(painter);

  return (
    <div
      aria-hidden
      data-testid="mini-progress"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-surface-hover"
    >
      <div ref={lineRef} className="size-full origin-left scale-x-(--progress) bg-accent" />
    </div>
  );
}
