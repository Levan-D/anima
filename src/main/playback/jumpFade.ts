/*
 * What keeps a jump chosen by hand quiet. mpv stops and resets the output when a file is left early, which it never does
 * when one runs out, and that reset is where a device can misbehave. So the output is taken to silence first, stays there
 * through the reset and the new file's first buffers, and comes back after. Each step is mpv's `volume`, which it applies
 * as the output takes each block, while a filter would lag by everything already buffered.
 */

export type JumpFadeTimes = {
  outMs: number;
  /** Silence going through the device's own buffers, so a reset has nothing else left in them. */
  flushMs: number;
  /** Silence after the new file starts, spent while the device starts up again. It costs this much of the track's start. */
  holdMs: number;
  inMs: number;
};

export const JUMP_FADE_TIMES: JumpFadeTimes = { outMs: 40, flushMs: 20, holdMs: 20, inMs: 20 };

const TICK_MS = 4;
// A busy moment can't turn the fade into a cut: however late a step is, it only goes this much further.
const MOST_OF_A_RAMP_PER_STEP = 1 / 3;
// Past a cold disk's load (1.6 s measured), for whatever means no new file is coming. Stuck silent is the worst way to fail.
const GIVE_UP_MS = 3_000;

type Phase = 'open' | 'falling' | 'flushing' | 'silent' | 'holding' | 'rising';

/** mpv's volume is cubic, so this is what gets a share of the gain, and the steps come out even. */
export function volumeForShare(volume: number, share: number): number {
  return volume * Math.cbrt(share);
}

export type JumpFade = ReturnType<typeof createJumpFade>;

export function createJumpFade({
  times,
  volume,
  setVolume,
}: {
  times: JumpFadeTimes;
  /** The volume that's been chosen, read at each step, so moving the slider during a fade counts. */
  volume: () => number;
  setVolume: (value: number) => void;
}) {
  let phase: Phase = 'open';
  let share = 1;
  let isReleased = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let giveUp: ReturnType<typeof setTimeout> | null = null;
  let gone: { promise: Promise<void>; finish: () => void } | null = null;

  function clearTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function apply(next: number): void {
    share = next;
    setVolume(volumeForShare(volume(), next));
  }

  function ramp(from: number, to: number, lengthMs: number, done: () => void): void {
    let at = performance.now();
    let progress = 0;
    const step = (): void => {
      const now = performance.now();
      const moved = lengthMs <= 0 ? 1 : (now - at) / lengthMs;
      at = now;
      progress += Math.min(moved, MOST_OF_A_RAMP_PER_STEP);
      if (progress >= 1) {
        apply(to);
        done();
        return;
      }
      apply(from + (to - from) * progress);
      timer = setTimeout(step, TICK_MS);
    };
    step();
  }

  function finishGone(): void {
    gone?.finish();
    gone = null;
  }

  function open(): void {
    clearTimer();
    if (giveUp !== null) clearTimeout(giveUp);
    giveUp = null;
    phase = 'open';
    isReleased = false;
    finishGone();
    apply(1);
  }

  function hold(lengthMs: number): void {
    phase = 'holding';
    timer = setTimeout(() => {
      phase = 'rising';
      ramp(0, 1, times.inMs, open);
    }, lengthMs);
  }

  function armGiveUp(): void {
    if (giveUp !== null) clearTimeout(giveUp);
    giveUp = setTimeout(open, GIVE_UP_MS);
  }

  function makeGone(): void {
    if (gone !== null) return;
    let finish = () => {};
    const promise = new Promise<void>((resolve) => {
      finish = resolve;
    });
    gone = { promise, finish };
  }

  return {
    /** A fade or a silence is under way, so the volume isn't the slider's to set until it's over. */
    isActive: () => phase !== 'open',

    /** Nothing's coming out to fade, as when paused, so it goes straight to silent. */
    silence(): void {
      if (phase === 'falling' || phase === 'flushing' || phase === 'silent') return;
      clearTimer();
      phase = 'silent';
      isReleased = false;
      apply(0);
      armGiveUp();
    },

    fadeOut(): void {
      armGiveUp();
      isReleased = false;
      if (phase === 'falling' || phase === 'flushing' || phase === 'silent') return;
      clearTimer();
      makeGone();
      phase = 'falling';
      ramp(share, 0, times.outMs, () => {
        phase = 'flushing';
        timer = setTimeout(() => {
          phase = 'silent';
          finishGone();
          if (isReleased) hold(times.holdMs);
        }, times.flushMs);
      });
    },

    /** Resolves once the old audio is out of the device. Null when there's nothing to wait for. */
    oldAudioGone: (): Promise<void> | null => gone?.promise ?? null,

    /** The new audio has started. */
    release({ immediately }: { immediately: boolean }): void {
      if (phase === 'open') return;
      if (immediately) {
        open();
        return;
      }
      if (phase === 'silent') hold(times.holdMs);
      else if (phase === 'falling' || phase === 'flushing') isReleased = true;
    },

    dispose(): void {
      clearTimer();
      if (giveUp !== null) clearTimeout(giveUp);
      giveUp = null;
      finishGone();
      phase = 'open';
    },
  };
}
