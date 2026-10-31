import { useCallback, useRef, useState } from 'react';
import { motionDuration } from '@/lib/motionTokens';
import { PAINT_EVERY_MS, usePlayerPosition, type PositionPainter } from '@/lib/playerPosition';
import { playerState } from '@/lib/playerStore';

/** Each bar's own speed and starting point, so they never line up for long. */
const BARS = [
  { speed: 1, start: 0 },
  { speed: 1.37, start: 2.1 },
  { speed: 0.73, start: 4.2 },
];

function heightOf(bar: number, turns: number): number {
  const { speed, start } = BARS[bar % BARS.length] ?? { speed: 1, start: 0 };
  return 0.6 + 0.4 * Math.sin(turns * speed * 2 * Math.PI + start);
}

/**
 * Gets the element holding the bars. They move in the seekbar's frames, so they cost no frames of their own, and they hold
 * still when it does: while paused and in a hidden window. Under reduced motion they don't move at all.
 */
export function useMovingBars() {
  const barsRef = useRef<HTMLSpanElement>(null);
  const [secondsPerTurn] = useState(() => motionDuration('--dur-loop'));

  const painter = useCallback<PositionPainter>(() => {
    const bars = barsRef.current;
    if (!bars || secondsPerTurn === 0) return Infinity;
    if (playerState().status !== 'playing') return PAINT_EVERY_MS;

    const turns = performance.now() / 1000 / secondsPerTurn;
    [...bars.children].forEach((bar, index) => {
      if (bar instanceof HTMLElement) bar.style.transform = `scaleY(${heightOf(index, turns).toFixed(3)})`;
    });
    return PAINT_EVERY_MS;
  }, [secondsPerTurn]);
  usePlayerPosition(painter);

  return barsRef;
}
