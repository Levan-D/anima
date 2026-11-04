import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, type RefObject } from 'react';
import { PAINT_EVERY_MS, usePlayerPosition, type PositionPainter } from '@/lib/playerPosition';
import { waveformQuery } from '@/lib/playerQueries';
import { usePlayer } from '@/lib/playerStore';

/** How long the loudness takes to follow the music: slow enough that it swells with a passage, never with a beat. */
const FOLLOW_S = 3;
/** The quiet end of a song's own range: most songs never fall to silence, and against it they'd hardly move. */
const QUIET_SHARE = 0.1;
/** A pause or a hidden window isn't time the motion should jump over. */
const MOST_PER_STEP_S = 0.5;
const REDUCED = '(prefers-reduced-motion: reduce)';

type Range = { quiet: number; loud: number };

function rangeOf(rms: Uint8Array | null): Range {
  if (rms === null || rms.length === 0) return { quiet: 0, loud: 1 };
  const sorted = rms.toSorted((a, b) => a - b);
  const quiet = sorted[Math.floor(sorted.length * QUIET_SHARE)] ?? 0;
  return { quiet, loud: Math.max(quiet + 1, sorted.at(-1) ?? 1) };
}

/**
 * `--loud` on `ref`, 0 to 1 across the song's own range, written four times a second while it plays. It comes from the
 * stored waveform at the play position, since mpv doesn't hand over the sound.
 */
export function useMusicMotion(ref: RefObject<HTMLElement | null>): void {
  const trackId = usePlayer((state) => state.current?.id ?? null);
  const waveform = useQuery(waveformQuery(trackId));
  const rms = waveform.data?.rms ?? null;
  const range = useMemo(() => rangeOf(rms), [rms]);
  const motion = useRef<{ loud: number; lastMs: number | null }>({ loud: 0, lastMs: null });

  const painter = useCallback<PositionPainter>(
    (positionMs, durationMs) => {
      const element = ref.current;
      if (element === null || matchMedia(REDUCED).matches) return Infinity;
      const now = performance.now();
      const state = motion.current;
      const step = state.lastMs === null ? 0 : Math.min((now - state.lastMs) / 1000, MOST_PER_STEP_S);
      state.lastMs = now;

      const share = durationMs > 0 ? positionMs / durationMs : 0;
      const bucket = rms === null ? 0 : (rms[Math.min(rms.length - 1, Math.floor(share * rms.length))] ?? 0);
      const level = Math.min(Math.max((bucket - range.quiet) / (range.loud - range.quiet), 0), 1);
      state.loud += (level - state.loud) * (1 - Math.exp(-step / FOLLOW_S));
      element.style.setProperty('--loud', state.loud.toFixed(3));
      return PAINT_EVERY_MS;
    },
    [ref, rms, range],
  );
  usePlayerPosition(painter);
}
