import { formatDuration } from '@/lib/format';
import { PAINT_EVERY_MS } from '@/lib/playerPosition';

const STEP_MS = 5_000;
const BIG_STEP_MS = 30_000;
/** How many moves the line makes from end to end: half a pixel each on the laptop, and still too small to see on the TV. */
const LINE_STEPS = 1024;

const STEP_DIRECTIONS: Record<string, 1 | -1> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };
const PAGE_DIRECTIONS: Record<string, 1 | -1> = { PageUp: 1, PageDown: -1 };

type KeyPress = {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
};

/**
 * Where a key takes the playhead. Undefined when it's not a key for this. Null when it's one the slider must not act on
 * by itself, such as Alt+Left, which goes back.
 */
export function seekTarget(
  { key, shiftKey, altKey }: KeyPress,
  positionMs: number,
  durationMs: number,
): number | null | undefined {
  if (key === 'Home') return 0;
  if (key === 'End') return durationMs;

  const step = STEP_DIRECTIONS[key];
  const page = PAGE_DIRECTIONS[key];
  if (step === undefined && page === undefined) return undefined;
  if (altKey) return null;

  const distance = page !== undefined ? page * BIG_STEP_MS : (step ?? 1) * (shiftKey ? BIG_STEP_MS : STEP_MS);
  return Math.min(Math.max(positionMs + distance, 0), durationMs);
}

/** How long before there's anything new to draw: the next step of the line, or the next tick of the clock. */
export function msUntilChange(positionMs: number, durationMs: number): number {
  if (durationMs <= 0) return Infinity;
  return Math.min(1000 - (positionMs % 1000), Math.max(durationMs / LINE_STEPS, PAINT_EVERY_MS));
}

type TimeWords = {
  /** `0:01 / 2:51` */
  time: string;
  /** What a screen reader says, where the slider's number would just be milliseconds. */
  spoken: string;
};

const NOTHING: TimeWords = { time: '', spoken: '' };

export function timeWords(positionMs: number, durationMs: number): TimeWords {
  if (durationMs <= 0) return NOTHING;
  const elapsed = formatDuration(Math.min(positionMs, durationMs));
  const total = formatDuration(durationMs);
  return { time: `${elapsed} / ${total}`, spoken: `${elapsed} of ${total}` };
}
