import { useQuery } from '@tanstack/react-query';
import { useCallback, useRef, type KeyboardEvent } from 'react';
import { LiveSlider, type LiveSliderHandle } from '@/components/ui/LiveSlider';
import { Text } from '@/components/ui/Text';
import { Waveform, type WaveformHandle } from '@/features/Transport/components/Waveform';
import { msUntilChange, seekTarget, timeWords } from '@/features/Transport/utils/seekbarMath';
import { seekTo } from '@/lib/playerActions';
import { currentPosition, usePlayerPosition, type PositionPainter } from '@/lib/playerPosition';
import { waveformQuery } from '@/lib/playerQueries';
import { playerState, usePlayer } from '@/lib/playerStore';
import { queryClient } from '@/lib/queryClient';

/**
 * A slider, what it draws and the time. None of it re-renders as the song plays: the position goes straight to the DOM
 * from here, and a drag just stops listening to it until it lets go. The line shows until there's a waveform to show instead.
 */
export function Seekbar() {
  const durationMs = usePlayer((state) => state.durationMs);
  const canSeek = usePlayer((state) => state.current !== null && state.status !== 'unavailable');
  const trackId = usePlayer((state) => state.current?.id ?? null);
  const levels = useQuery(waveformQuery(trackId), queryClient).data ?? null;
  const shownLevels = canSeek ? levels : null;

  const sliderRef = useRef<LiveSliderHandle>(null);
  const waveformRef = useRef<WaveformHandle>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const draggedTo = useRef<number | null>(null);

  const show = useCallback<PositionPainter>((positionMs, length) => {
    const { time, spoken } = timeWords(positionMs, length);
    sliderRef.current?.show(positionMs, length, spoken);
    waveformRef.current?.show(length > 0 ? Math.min(Math.max(positionMs / length, 0), 1) : 0);
    const timeText = timeRef.current;
    if (timeText && timeText.textContent !== time) timeText.textContent = time;
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
    <div data-testid="seekbar" className="relative mt-2">
      <Waveform ref={waveformRef} data={shownLevels} />
      <LiveSlider
        ref={sliderRef}
        label="Seek"
        max={Math.max(durationMs, 1)}
        disabled={!canSeek}
        onDrag={onDrag}
        onDragEnd={onDragEnd}
        onKeyDown={onKeyDown}
        trackClassName={shownLevels === null ? 'duration-(--dur-mid)' : 'opacity-0 duration-(--dur-mid)'}
      />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0.5 flex">
        <Text ref={timeRef} variant="meta" color="muted" tabular data-testid="elapsed" />
      </div>
    </div>
  );
}
