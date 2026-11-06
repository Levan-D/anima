import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, type RefObject } from 'react';
import { PAINT_EVERY_MS, usePlayerPosition, type PositionPainter } from '@/lib/playerPosition';
import { waveformQuery } from '@/lib/playerQueries';
import { usePlayer } from '@/lib/playerStore';
import { prefersReducedMotion } from '@/lib/motionTokens';

/** How long the loudness takes to follow the music: slow enough that it swells with a passage, never with a beat. */
const FOLLOW_S = 3;
/** The quiet end of a song's own range: most songs never fall to silence, and against it they'd hardly move. */
const QUIET_SHARE = 0.1;
/** A pause or a hidden window isn't time the motion should jump over. */
const MOST_PER_STEP_S = 0.5;
/** A little longer than a step, so one glide is still going when the next takes over: no stop between. */
const GLIDE_MS = 300;
/**
 * In steps, about thirty a second, as the lamp draws. Gliding smoothly would have the GPU draw the whole window at the
 * screen's rate, 120 times a second on a 120 Hz one, for a swell too slow to see the difference.
 */
const GLIDE_EASING = `steps(${Math.round(GLIDE_MS / (1000 / 30))}, jump-end)`;

type Look = { scale?: number; opacity: number };
type Glide = { animation: Animation; to: Look };

/** What each layer looks like at a loudness, from 0 to 1. At 0 it's what the stylesheet gives it before any music. */
const breatheAt = (loud: number): Look => ({ scale: 1 + loud * 0.22, opacity: 0.4 + loud * 0.6 });
const lavaAt = (loud: number): Look => ({ opacity: 0.42 + loud * 0.21 });

/**
 * From wherever the last glide was heading. Web Animations on scale and opacity run on the compositor: a custom property
 * transitioned in CSS would have the page work out its styles and redraw every frame.
 */
function glide(element: Element | null, to: Look, glides: WeakMap<Element, Glide>): void {
  if (element === null) return;
  const previous = glides.get(element);
  const from = previous?.to ?? to;
  const animation = element.animate([{ ...from }, { ...to }], {
    duration: GLIDE_MS,
    easing: GLIDE_EASING,
    fill: 'forwards',
  });
  previous?.animation.cancel();
  glides.set(element, { animation, to });
}

type Range = { quiet: number; loud: number };

function rangeOf(rms: Uint8Array | null): Range {
  if (rms === null || rms.length === 0) return { quiet: 0, loud: 1 };
  const sorted = rms.toSorted((a, b) => a - b);
  const quiet = sorted[Math.floor(sorted.length * QUIET_SHARE)] ?? 0;
  return { quiet, loud: Math.max(quiet + 1, sorted.at(-1) ?? 1) };
}

type Layers = {
  breathe: RefObject<HTMLElement | null>;
  lava: RefObject<HTMLElement | null>;
  /** Where the loudness is now, for what draws its own frames. */
  loudRef: RefObject<number>;
};

/**
 * How loud the song is, 0 to 1 across its own range, worked out four times a second while it plays, and the layers gliding
 * to match. It comes from the stored waveform at the play position, since mpv doesn't hand over the sound.
 */
export function useMusicMotion({ breathe, lava, loudRef }: Layers): void {
  const trackId = usePlayer((state) => state.current?.id ?? null);
  const waveform = useQuery(waveformQuery(trackId));
  const rms = waveform.data?.rms ?? null;
  const range = useMemo(() => rangeOf(rms), [rms]);
  const motion = useRef<{ loud: number; lastMs: number | null }>({ loud: 0, lastMs: null });
  const glides = useRef(new WeakMap<Element, Glide>());

  const painter = useCallback<PositionPainter>(
    (positionMs, durationMs) => {
      if (prefersReducedMotion()) return Infinity;
      const now = performance.now();
      const state = motion.current;
      const step = state.lastMs === null ? 0 : Math.min((now - state.lastMs) / 1000, MOST_PER_STEP_S);
      state.lastMs = now;

      const share = durationMs > 0 ? positionMs / durationMs : 0;
      const bucket = rms === null ? 0 : (rms[Math.min(rms.length - 1, Math.floor(share * rms.length))] ?? 0);
      const level = Math.min(Math.max((bucket - range.quiet) / (range.loud - range.quiet), 0), 1);
      state.loud += (level - state.loud) * (1 - Math.exp(-step / FOLLOW_S));
      loudRef.current = state.loud;
      glide(breathe.current, breatheAt(state.loud), glides.current);
      glide(lava.current, lavaAt(state.loud), glides.current);
      return PAINT_EVERY_MS;
    },
    [breathe, lava, loudRef, rms, range],
  );
  usePlayerPosition(painter);
}
