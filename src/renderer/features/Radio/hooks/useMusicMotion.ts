import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, type RefObject } from 'react';
import type { WaveformData } from '@shared/domain';
import { PAINT_EVERY_MS, usePlayerPosition, type PositionPainter } from '@/lib/playerPosition';
import { waveformQuery } from '@/lib/playerQueries';
import { usePlayer } from '@/lib/playerStore';

/** How long the loudness takes to follow the music: long enough that it swells rather than pulses. */
const FOLLOW_S = 2.5;
/** What a ripple rises above: the loudness over a much longer stretch. */
const BACKGROUND_S = 12;
const RIPPLE_RISE = 0.12;
const RIPPLE_S = 6;
const RIPPLE_REST_S = 10;
/** A pause or a hidden window isn't time the motion should jump over. */
const MOST_PER_STEP_S = 0.5;

type Motion = { clock: number; loud: number; background: number; rippleAt: number; lastMs: number | null };

const REDUCED = '(prefers-reduced-motion: reduce)';

/**
 * Slow numbers that follow the song, written as CSS variables on `ref` four times a second while it plays: `--clock` in
 * seconds of playing, `--loud` 0 to 1 against the song's own loudest, `--ripple` 0 to 1 through a ripple after a swell,
 * and `--progress`. Loudness comes from the stored waveform, since mpv doesn't hand over the sound. Gives the waveform
 * back for whatever draws it.
 */
export function useMusicMotion(ref: RefObject<HTMLElement | null>): WaveformData | null {
  const trackId = usePlayer((state) => state.current?.id ?? null);
  const waveform = useQuery(waveformQuery(trackId));
  const rms = waveform.data?.rms ?? null;
  const loudest = useMemo(() => (rms === null ? 1 : Math.max(1, ...rms)), [rms]);
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
      const level = bucket / loudest;
      state.clock += step;
      state.loud += (level - state.loud) * (1 - Math.exp(-step / FOLLOW_S));
      state.background += (level - state.background) * (1 - Math.exp(-step / BACKGROUND_S));
      if (state.loud - state.background > RIPPLE_RISE && state.clock - state.rippleAt > RIPPLE_REST_S) {
        state.rippleAt = state.clock;
      }

      element.style.setProperty('--clock', state.clock.toFixed(2));
      element.style.setProperty('--loud', state.loud.toFixed(3));
      element.style.setProperty('--ripple', Math.min((state.clock - state.rippleAt) / RIPPLE_S, 1).toFixed(3));
      element.style.setProperty('--progress', share.toFixed(4));
      return PAINT_EVERY_MS;
    },
    [ref, rms, loudest],
  );
  usePlayerPosition(painter);
  return waveform.data ?? null;
}
