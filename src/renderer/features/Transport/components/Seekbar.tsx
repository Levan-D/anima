import { useCallback, useRef, type KeyboardEvent } from 'react';
import { LiveSlider, type LiveSliderHandle } from '@/components/ui/LiveSlider';
import { Text } from '@/components/ui/Text';
import { msUntilChange, seekTarget, timeWords } from '@/features/Transport/utils/seekbarMath';
import { seekTo } from '@/lib/playerActions';
import { currentPosition, usePlayerPosition, type PositionPainter } from '@/lib/playerPosition';
import { playerState, usePlayer } from '@/lib/playerStore';

/**
 * A line and two times. None of it re-renders as the song plays: the position goes straight to the DOM from here, and a
 * drag just stops listening to it until it lets go. Its own component, because the waveform takes its place in Phase 6.
 */
export function Seekbar() {
  const durationMs = usePlayer((state) => state.durationMs);
  const canSeek = usePlayer((state) => state.current !== null && state.status !== 'unavailable');

  const sliderRef = useRef<LiveSliderHandle>(null);
  const elapsedRef = useRef<HTMLSpanElement>(null);
  const remainingRef = useRef<HTMLSpanElement>(null);
  const draggedTo = useRef<number | null>(null);

  const show = useCallback<PositionPainter>((positionMs, length) => {
    const { elapsed, remaining, spoken } = timeWords(positionMs, length);
    sliderRef.current?.show(positionMs, length, spoken);
    const elapsedText = elapsedRef.current;
    const remainingText = remainingRef.current;
    if (elapsedText && elapsedText.textContent !== elapsed) elapsedText.textContent = elapsed;
    if (remainingText && remainingText.textContent !== remaining) remainingText.textContent = remaining;
  }, []);

  const painter = useCallback<PositionPainter>(
    (positionMs, length) => {
      if (draggedTo.current === null) show(positionMs, length);
      return msUntilChange(positionMs, length);
    },
    [show],
  );
  usePlayerPosition(painter);

  function onDrag(value: number): void {
    draggedTo.current = value;
    show(value, playerState().durationMs);
  }

  function onDragEnd(committed: boolean): void {
    const target = draggedTo.current;
    draggedTo.current = null;
    if (committed && target !== null) seekTo(target);
    else show(currentPosition(), playerState().durationMs);
  }

  function onKeyDown(event: KeyboardEvent): void {
    const target = seekTarget(event, currentPosition(), playerState().durationMs);
    if (target === undefined) return;
    event.preventDefault();
    if (target !== null) seekTo(target);
  }

  return (
    <div data-testid="seekbar" className="relative">
      <LiveSlider
        ref={sliderRef}
        label="Seek"
        max={Math.max(durationMs, 1)}
        disabled={!canSeek}
        onDrag={onDrag}
        onDragEnd={onDragEnd}
        onKeyDown={onKeyDown}
      />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0.5 flex justify-between">
        <Text ref={elapsedRef} variant="meta" color="muted" tabular data-testid="elapsed" />
        <Text ref={remainingRef} variant="meta" color="muted" tabular data-testid="remaining" />
      </div>
    </div>
  );
}
