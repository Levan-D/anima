import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, type RefObject } from 'react';
import type { WaveformData } from '@shared/domain';
import { PAINT_EVERY_MS, usePlayerPosition, type PositionPainter } from '@/lib/playerPosition';
import { waveformQuery } from '@/lib/playerQueries';
import { usePlayer } from '@/lib/playerStore';

/** How long the loudness takes to follow the music: long enough that it swells rather than pulses. */
const FOLLOW_S = 1.2;
/** What a ripple rises above: the loudness over a much longer stretch. */
const BACKGROUND_S = 10;
const RIPPLE_RISE = 0.1;
const RIPPLE_REST_S = 6;
const RIPPLE: Keyframe[] = [
  { scale: '1', strokeOpacity: 0.35 },
  { scale: '3.4', strokeOpacity: 0 },
];
const RIPPLE_TIMING: KeyframeAnimationOptions = { duration: 5000, easing: 'cubic-bezier(0.2, 0.6, 0.3, 1)' };
/** The quiet end of a song's own range: most songs never fall to silence, and against it they'd hardly move. */
const QUIET_SHARE = 0.1;
/** A pause or a hidden window isn't time the motion should jump over. */
const MOST_PER_STEP_S = 0.5;

type Motion = { clock: number; loud: number; background: number; rippleAt: number; lastMs: number | null };
type Range = { quiet: number; loud: number };

function rangeOf(rms: Uint8Array | null): Range {
  if (rms === null || rms.length === 0) return { quiet: 0, loud: 1 };
  const sorted = rms.toSorted((a, b) => a - b);
  const quiet = sorted[Math.floor(sorted.length * QUIET_SHARE)] ?? 0;
  return { quiet, loud: Math.max(quiet + 1, sorted.at(-1) ?? 1) };
}

const REDUCED = '(prefers-reduced-motion: reduce)';

/**
 * Slow numbers that follow the song, written as CSS variables on `ref` four times a second while it plays: `--clock` in
 * seconds of playing, `--loud` 0 to 1 across the song's own range, and `--progress`. After a swell, `.ambience-ripple`
 * inside it sends out a ring. Loudness comes from the stored waveform, since mpv doesn't hand over the sound. Gives the
 * waveform back for whatever draws it.
 */
export function useMusicMotion(ref: RefObject<HTMLElement | null>): WaveformData | null {
  const trackId = usePlayer((state) => state.current?.id ?? null);
  const waveform = useQuery(waveformQuery(trackId));
  const rms = waveform.data?.rms ?? null;
  const range = useMemo(() => rangeOf(rms), [rms]);
  const motion = useRef<Motion>({ clock: 0, loud: 0, background: 0, rippleAt: -Infinity, lastMs: null });

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
      state.clock += step;
      state.loud += (level - state.loud) * (1 - Math.exp(-step / FOLLOW_S));
      state.background += (level - state.background) * (1 - Math.exp(-step / BACKGROUND_S));
      if (state.loud - state.background > RIPPLE_RISE && state.clock - state.rippleAt > RIPPLE_REST_S) {
        state.rippleAt = state.clock;
        element.querySelector('.ambience-ripple')?.animate(RIPPLE, RIPPLE_TIMING);
      }

      element.style.setProperty('--clock', state.clock.toFixed(2));
      element.style.setProperty('--loud', state.loud.toFixed(3));
      element.style.setProperty('--progress', share.toFixed(4));
      return PAINT_EVERY_MS;
    },
    [ref, rms, range],
  );
  usePlayerPosition(painter);
  return waveform.data ?? null;
}
