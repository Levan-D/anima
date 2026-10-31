/*
 * Where playback is between the reports from main, which come about five times a second. Pure, so what it does with a
 * late tick, a backward step or a seek can be tested without waiting for any of them.
 */

export type PositionClock = {
  positionMs: number;
  /** When it was at `positionMs`, on the same clock as `now`. */
  at: number;
  isRunning: boolean;
  /** Until then a report far from here is one that left main before a seek did. */
  settlingUntil: number;
};

export const STOPPED_AT_ZERO: PositionClock = { positionMs: 0, at: 0, isRunning: false, settlingUntil: 0 };

// A seek is confirmed in a few milliseconds. This only has to outlast the ticks that were already on their way.
const SETTLE_MS = 500;
const FAR_MS = 1_000;
// A report closer than this is jitter: mpv's own ticks come 50 to 200 ms apart.
const JITTER_MS = 250;
const CATCH_UP = 0.25;

export function positionAt({ positionMs, at, isRunning }: PositionClock, now: number): number {
  return isRunning ? positionMs + Math.max(now - at, 0) : positionMs;
}

/** A report from main. While it's running the numbers only go forward, so the elapsed time can't flick back a second. */
export function reported(clock: PositionClock, positionMs: number, now: number): PositionClock {
  const expected = positionAt(clock, now);
  const drift = positionMs - expected;

  if (now < clock.settlingUntil && Math.abs(drift) > FAR_MS) return clock;
  if (clock.isRunning && drift < 0 && drift > -JITTER_MS) return { ...clock, positionMs: expected, at: now };
  if (clock.isRunning && drift >= 0 && drift < JITTER_MS) {
    return { ...clock, positionMs: expected + drift * CATCH_UP, at: now };
  }
  return { ...clock, positionMs, at: now };
}

/** Moves right away, for a seek that main hasn't answered yet. */
export function seeked(clock: PositionClock, positionMs: number, now: number): PositionClock {
  return { ...clock, positionMs, at: now, settlingUntil: now + SETTLE_MS };
}

export function setRunning(clock: PositionClock, isRunning: boolean, now: number): PositionClock {
  if (clock.isRunning === isRunning) return clock;
  return { ...clock, positionMs: positionAt(clock, now), at: now, isRunning };
}

/** A different track, or a start over. */
export function restarted(clock: PositionClock, now: number): PositionClock {
  return { ...clock, positionMs: 0, at: now, settlingUntil: 0 };
}
