/*
 * From the queue to what mpv should hold: the current stretch of audio and the one after it, and the steps to get
 * there from what it holds now. Steps are worked out one pass at a time, so whatever happens between two of them is
 * looked at before the next.
 */

import { isPartOfFile, runFrom, type RangedItem, type Run } from './cueBoundaries';

export type HeldEntry = {
  entryId: number;
  /** The first queue item it plays. */
  queueId: number;
  fileId: number;
  /** What mpv was told to stop at. */
  endMs: number | null;
};

export type Held = {
  /** mpv's playlist, in order, counting every command sent so far. */
  entries: HeldEntry[];
  /** The entry mpv is on, or has been told to go to. */
  playingId: number | null;
  /** The queue item it's on, which can be further along a stretch than the entry's first. */
  atQueueId: number | null;
  /** Its file is open, so a seek would work. */
  isLoaded: boolean;
  /** One entry ended and mpv is starting the next by itself, so there's nothing to do until it says so. */
  isMovingOn: boolean;
};

export type WindowStep =
  | { kind: 'stop' }
  | { kind: 'load'; mode: 'replace' | 'append'; run: Run }
  | { kind: 'next' }
  | { kind: 'remove'; index: number }
  | { kind: 'set-end'; endMs: number | null }
  | { kind: 'seek'; queueId: number; fileMs: number };

export const NOTHING_HELD: Held = {
  entries: [],
  playingId: null,
  atQueueId: null,
  isLoaded: false,
  isMovingOn: false,
};

const toSeconds = (ms: number) => (ms / 1000).toFixed(3);

/** For setting where a file stops once it's playing. */
export function endOption(endMs: number | null): string {
  return endMs === null ? 'none' : toSeconds(endMs);
}

/** The fourth argument of loadfile. Empty for a whole file from the top. */
export function fileOptions({ startMs, endMs }: { startMs: number; endMs: number | null }): string {
  const options = [startMs > 0 && `start=${toSeconds(startMs)}`, endMs !== null && `end=${toSeconds(endMs)}`];
  return options.filter((option) => option !== false).join(',');
}

function holdsRun(entry: HeldEntry | undefined, run: Run | null): entry is HeldEntry {
  return entry !== undefined && run !== null && entry.queueId === run.firstQueueId && entry.endMs === run.endMs;
}

/** mpv is on the right thing: everything else around it gets put right, without touching what's playing. */
function around(held: Held, playing: HeldEntry, wanted: Run, next: Run | null): WindowStep[] {
  const at = held.entries.indexOf(playing);
  const keepsNext = holdsRun(held.entries[at + 1], next);
  const steps: WindowStep[] = [];
  // From the far end, so each index still means the same entry when its turn comes.
  for (let index = held.entries.length - 1; index > at + (keepsNext ? 1 : 0); index--) {
    steps.push({ kind: 'remove', index });
  }
  for (let index = at - 1; index >= 0; index--) steps.push({ kind: 'remove', index });
  if (playing.endMs !== wanted.endMs) steps.push({ kind: 'set-end', endMs: wanted.endMs });
  if (next !== null && !keepsNext) steps.push({ kind: 'load', mode: 'append', run: next });
  return steps;
}

function replaceAll(wanted: Run, next: Run | null): WindowStep[] {
  return [
    { kind: 'load', mode: 'replace', run: wanted },
    ...(next === null ? [] : [{ kind: 'load', mode: 'append', run: next } satisfies WindowStep]),
  ];
}

/**
 * `index` is the item that should be playing, or null when nothing should. `canHold` says no to an item that can't be
 * loaded ahead of time, so it's only tried when its turn comes.
 */
export function planWindow(
  items: readonly RangedItem[],
  index: number | null,
  held: Held,
  canHold: (item: RangedItem) => boolean = () => true,
): WindowStep[] {
  if (index === null) return held.entries.length > 0 ? [{ kind: 'stop' }] : [];

  const wanted = runFrom(items, index);
  const current = items[index];
  if (wanted === null || current === undefined) return held.entries.length > 0 ? [{ kind: 'stop' }] : [];
  if (held.isMovingOn) return [];

  const after = items[index + wanted.queueIds.length];
  const next = after !== undefined && canHold(after) ? runFrom(items, index + wanted.queueIds.length) : null;

  const playing = held.entries.find(({ entryId }) => entryId === held.playingId);
  if (playing === undefined) return replaceAll(wanted, next);
  if (held.atQueueId === current.queueId) return around(held, playing, wanted, next);

  const following = held.entries[held.entries.indexOf(playing) + 1];
  if (following?.queueId === current.queueId) return [{ kind: 'next' }];

  if (playing.fileId === wanted.fileId && isPartOfFile(current.range) && held.isLoaded) {
    // An end behind where the file is now stops it on the spot, whichever side of the seek it's set on. So the old end
    // goes first, then the seek, and the next pass sets the new one.
    return [
      ...(playing.endMs === null ? [] : [{ kind: 'set-end', endMs: null } satisfies WindowStep]),
      { kind: 'seek', queueId: current.queueId, fileMs: wanted.startMs },
    ];
  }
  return replaceAll(wanted, next);
}
