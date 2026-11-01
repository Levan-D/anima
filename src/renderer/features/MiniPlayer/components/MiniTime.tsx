import { useCallback, useRef } from 'react';
import { Text } from '@/components/ui/Text';
import { formatElapsed } from '@/lib/format';
import { PAINT_EVERY_MS, usePlayerPosition, type PositionPainter } from '@/lib/playerPosition';

const SECOND_MS = 1000;

/** `0:10 / 3:39`, written straight to the DOM when the second changes. */
export function MiniTime() {
  const timeRef = useRef<HTMLSpanElement>(null);

  const painter = useCallback<PositionPainter>((positionMs, durationMs) => {
    const time = timeRef.current;
    if (!time) return Infinity;
    const text = formatElapsed(positionMs, durationMs);
    if (time.textContent !== text) time.textContent = text;
    return Math.max(PAINT_EVERY_MS, SECOND_MS - (positionMs % SECOND_MS));
  }, []);
  usePlayerPosition(painter);

  return <Text ref={timeRef} variant="meta" color="muted" tabular data-testid="mini-time" className="shrink-0" />;
}
