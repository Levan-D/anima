/*
 * Turns where playback has got to into plays. Only small steps forward count as heard, so a seek adds nothing, and one
 * listen is one play at most. A row only exists once it's a play: time on a track skipped before that isn't kept.
 */

import type { ListeningReport } from '@main/playback/player';

const MAX_HEARD_STEP_MS = 2_000;
const PLAY_AFTER_MS = 30_000;
const SAVE_EVERY_MS = 30_000;

export type ListenStore = {
  /** Returns the row's id, or null if it couldn't be written. */
  recordPlay: (trackId: number, listenedMs: number) => number | null;
  saveListened: (eventId: number, listenedMs: number) => void;
};

type Listen = {
  listen: number;
  lastMs: number;
  heardMs: number;
  isRecorded: boolean;
  eventId: number | null;
  savedMs: number;
};

function playAfterMs(durationMs: number): number {
  return durationMs > 0 ? Math.min(PLAY_AFTER_MS, durationMs / 2) : PLAY_AFTER_MS;
}

export function createListenLog(store: ListenStore) {
  let current: Listen | null = null;

  function save(): void {
    if (current?.eventId == null || current.heardMs === current.savedMs) return;
    store.saveListened(current.eventId, Math.round(current.heardMs));
    current.savedMs = current.heardMs;
  }

  return {
    position({ listen, trackId, durationMs, positionMs }: ListeningReport): void {
      if (current?.listen !== listen) {
        save();
        current = { listen, lastMs: positionMs, heardMs: 0, isRecorded: false, eventId: null, savedMs: 0 };
        return;
      }

      const step = positionMs - current.lastMs;
      current.lastMs = positionMs;
      if (step <= 0 || step >= MAX_HEARD_STEP_MS) return;
      current.heardMs += step;

      if (!current.isRecorded) {
        if (current.heardMs < playAfterMs(durationMs)) return;
        current.isRecorded = true;
        current.eventId = store.recordPlay(trackId, Math.round(current.heardMs));
        current.savedMs = current.heardMs;
      } else if (current.heardMs - current.savedMs >= SAVE_EVERY_MS) {
        save();
      }
    },

    stopped(): void {
      save();
      current = null;
    },
  };
}
