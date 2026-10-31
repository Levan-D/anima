/*
 * The position, which changes too often for React. One subscription and one animation frame loop, shared by whoever
 * paints it: they get a call with the numbers, write to the DOM themselves, and say how long until they'd have anything
 * new to show. The loop sleeps until then, because a frame nobody needs still wakes the GPU, for as long as the album
 * lasts. It only runs at all while something is playing, something is listening and the window can be seen.
 */
import { useLayoutEffect } from 'react';
import type { PlayerPosition, PlayerState } from '@shared/domain';
import { call, on } from '@/lib/api';
import { onPlayerChange, playerState } from '@/lib/playerStore';
import { positionAt, reported, restarted, seeked, setRunning, STOPPED_AT_ZERO } from '@/lib/positionClock';
import { isWindowHidden, onWindowHiddenChange } from '@/lib/windowVisibility';

/** Returns how many milliseconds until it would next change anything. Nothing means every frame. */
export type PositionPainter = (positionMs: number, durationMs: number) => number | void;

/**
 * The most often anything that moves with the music should ask to be painted. All of it lands in the same frames, so this
 * is also how often the window presents one while the music plays. At 4 a second it presents freely on an Intel laptop
 * that holds up 5 to 20 a second for a tenth to almost half of every second (research/ui-stack.md).
 */
export const PAINT_EVERY_MS = 250;

const EVERY_FRAME = 0;
/** A report this far from where the clock says is a jump, which shouldn't wait for the next paint. */
const JUMP_MS = 100;

const painters = new Set<PositionPainter>();

let clock = STOPPED_AT_ZERO;
let loadId = 0;
let trackKey: string | null = null;
let frame: number | null = null;
let sleep: ReturnType<typeof setTimeout> | null = null;

function shownPosition(state: PlayerState, now: number): number {
  // Reports stop a moment short of the end, and a finished track shouldn't look like it was cut off.
  if (state.status === 'ended') return state.durationMs;
  if (state.current === null) return 0;
  return Math.min(positionAt(clock, now), state.durationMs);
}

/** Right now, for a key press to step from. */
export function currentPosition(): number {
  return shownPosition(playerState(), performance.now());
}

/** Returns how long until a paint is next wanted. */
function paint(): number {
  if (isWindowHidden()) return Infinity;
  const positionMs = currentPosition();
  const { durationMs } = playerState();
  let wait = Infinity;
  for (const painter of painters) wait = Math.min(wait, painter(positionMs, durationMs) ?? EVERY_FRAME);
  return wait;
}

function shouldRun(): boolean {
  return clock.isRunning && painters.size > 0 && !isWindowHidden();
}

function stopLoop(): void {
  if (frame !== null) cancelAnimationFrame(frame);
  if (sleep !== null) clearTimeout(sleep);
  frame = null;
  sleep = null;
}

function waitToPaint(wait: number): void {
  if (!shouldRun()) return;
  if (wait <= EVERY_FRAME) {
    frame = requestAnimationFrame(onFrame);
  } else if (Number.isFinite(wait)) {
    sleep = setTimeout(() => {
      sleep = null;
      frame = requestAnimationFrame(onFrame);
    }, wait);
  }
}

function onFrame(): void {
  frame = null;
  waitToPaint(paint());
}

/** Something changed that won't wait, and what's next is worked out from there. */
export function paintNow(): void {
  stopLoop();
  waitToPaint(paint());
}

function hear({ loadId: heardLoad, positionMs }: PlayerPosition): void {
  if (heardLoad < loadId) return;
  loadId = heardLoad;

  const now = performance.now();
  const before = positionAt(clock, now);
  clock = reported(clock, positionMs, now);
  // While it's running the next paint picks this up, unless it's too far to wait for.
  if (!clock.isRunning || Math.abs(positionAt(clock, now) - before) >= JUMP_MS) paintNow();
}

function askMain(): void {
  void call('player.position').then((result) => {
    if (result.ok) hear(result.value);
  });
}

function follow(state: PlayerState): void {
  const now = performance.now();
  const nextTrack = state.current === null ? null : `${state.queueIndex}:${state.current.id}`;

  if (state.loadId !== loadId) {
    // A reload of the same track carries on from where it was, and only main knows where that is.
    if (nextTrack !== trackKey) clock = restarted(clock, now);
    loadId = state.loadId;
    askMain();
  }
  trackKey = nextTrack;

  clock = setRunning(clock, state.status === 'playing', now);
  paintNow();
}

export function startPlayerPositionSync(): void {
  on('player.position', hear);
  onPlayerChange(follow);
  onWindowHiddenChange(paintNow);
  follow(playerState());
  askMain();
}

/** A seek on its way to main. The seekbar goes there now, and main's answer has only to agree. */
export function showSeek(positionMs: number): void {
  clock = seeked(clock, positionMs, performance.now());
  paintNow();
}

/** Keep `painter` stable, since a new one means subscribing again. It only writes to the DOM, so this runs before paint. */
export function usePlayerPosition(painter: PositionPainter): void {
  useLayoutEffect(() => {
    painters.add(painter);
    paintNow();
    return () => {
      painters.delete(painter);
      if (painters.size === 0) stopLoop();
    };
  }, [painter]);
}

/** For tests: everything here lives in the module. */
export function resetPlayerPosition(): void {
  stopLoop();
  painters.clear();
  clock = STOPPED_AT_ZERO;
  loadId = 0;
  trackKey = null;
}
