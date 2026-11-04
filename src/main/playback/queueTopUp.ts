/*
 * What the engine gets to add to a queue, and when: pure, so what must never happen by itself can be tested by itself.
 * Two things ask. Radio rolls, with several always waiting. Endless is a preference on the person's own queue, and only
 * asks when it's about to run out.
 */

import type { RadioEnergy, RadioProblem, RadioWithin, Track } from '@shared/domain';
import type { PlayableTrack } from '@main/library/queries';
import { appendToEnd, replaceQueue, type Queue, type QueuedTrack } from './queue';

export const RADIO_FILL = { askWhenLeft: 4, fillTo: 8 } as const;
const ENDLESS_FILL = { askWhenLeft: 1, fillTo: 4 } as const;
const SEEDS = 5;
/** Against the per-artist cap, along with what was skipped. */
const RECENT = 9;
const EXCLUDE = 200;
/** Long enough to still hold the last calm pick when they've become rare. */
const ENERGY_HISTORY = 30;
/** Behind the current one in radio's queue. Enough to go back through, without growing all night. */
const KEEP_PAST = 50;
const SHOWN_PAST = 3;
const SHOWN_NEXT = 12;

export type TopUpSource = 'radio' | 'endless' | null;

export type SuggestAsk = {
  seeds: number[];
  exclude: number[];
  recent: number[];
  count: number;
  /** Radio's only: 0 to 1. */
  wander?: number;
  origin?: Float32Array | null;
  /** What came before the picks being asked for, oldest first, or else the seeds. */
  history?: number[];
  /** Radio's only, while it's on. `calm` says which of the history were calm picks. */
  energy?: { settings: RadioEnergy; calm: readonly number[] };
  /** What the run was started from, whose seasonal theme counts as in season all the way through it. */
  asked?: readonly number[];
  /** Radio's only: what it stays within. */
  within?: RadioWithin | null;
};

export type RadioStartAnswer =
  | {
      first: number;
      trackIds: number[];
      calmPicks?: number[];
      origin: Float32Array | null;
      /** What it started from. */
      asked?: number[];
      within?: RadioWithin | null;
      hasSignals: boolean;
    }
  | { problem: RadioProblem };

export type SuggestAnswer = {
  trackIds: number[];
  /** Those radio asked for as calmer. */
  calmPicks?: number[];
  /** False when there's nothing at all to go on: no fingerprints or listener data in the library. */
  hasSignals: boolean;
};

export function topUpSource(isRadio: boolean, isEndless: boolean): TopUpSource {
  if (isRadio) return 'radio';
  return isEndless ? 'endless' : null;
}

/** The last few that played, newest last, leaving out what was skipped unless that's all there is. */
export function playedSeeds({ items, index }: Queue, skipped: readonly number[]): number[] {
  if (index === null) return [];
  const played = items.slice(0, index + 1).map(({ track }) => track.id);
  const liked = played.filter((id) => !skipped.includes(id));
  return (liked.length > 0 ? liked : played).slice(-SEEDS);
}

type TopUpQuestion = {
  queue: Queue;
  source: TopUpSource;
  /** Playing, and not asked about this queue already and told there's nothing. */
  canAsk: boolean;
  skipped?: readonly number[];
  heard?: readonly number[];
};

/** Null when nothing should be added. Radio's skips count twice against an artist: once played, once for being skipped. */
export function topUpAsk({ queue, source, canAsk, skipped = [], heard = [] }: TopUpQuestion): SuggestAsk | null {
  if (source === null || !canAsk || queue.index === null) return null;
  const { askWhenLeft, fillTo } = source === 'radio' ? RADIO_FILL : ENDLESS_FILL;
  const left = queue.items.length - queue.index - 1;
  if (left > askWhenLeft) return null;

  const inQueue = queue.items.map(({ track }) => track.id);
  return {
    seeds: playedSeeds(queue, skipped),
    exclude: [...heard, ...inQueue].slice(-EXCLUDE),
    recent: [...inQueue.slice(0, queue.index + 1).slice(-RECENT), ...skipped],
    count: fillTo - left,
    history: inQueue.slice(-ENERGY_HISTORY),
  };
}

/** Whatever was asked for, nothing that isn't on this machine goes in. Null means there was nothing to add. */
export function applyTopUp(queue: Queue, playable: readonly PlayableTrack[]): Queue | null {
  const owned = playable.filter(({ track }) => !track.isMissing);
  return owned.length === 0 ? null : appendToEnd(queue, owned);
}

export type RadioEntry = {
  /** What was playing, to stay behind the new one, for going back to and for the barrel to turn past. */
  past: PlayableTrack | null;
  /** The current item carrying on untouched, or a track to start. */
  current: QueuedTrack | PlayableTrack;
  picks: readonly PlayableTrack[];
};

function isQueued(track: QueuedTrack | PlayableTrack): track is QueuedTrack {
  return 'queueId' in track;
}

/** Radio's own queue. The one it replaces isn't touched. An item keeps its id, so mpv carries on with it uninterrupted. */
export function enterRadio(queue: Queue, { past, current, picks }: RadioEntry): Queue {
  const start = isQueued(current)
    ? { ...queue, items: [current], index: 0, addedEnd: 1 }
    : replaceQueue(queue, past === null ? [current] : [past, current], past === null ? 0 : 1);
  return appendToEnd(start, [...picks]);
}

/** What comes after the jump, in a queue where going to one drops what it went over: those were never heard. */
export function jumpOverIds({ items, index }: Queue, target: number): number[] {
  return index === null || target <= index ? [] : items.slice(index + 1, target).map(({ queueId }) => queueId);
}

/** Radio can run all night. What falls off still counts as heard, so it doesn't come round again. */
export function trimPast(queue: Queue): { queue: Queue; dropped: number[] } {
  const over = (queue.index ?? 0) - KEEP_PAST;
  if (queue.index === null || over <= 0) return { queue, dropped: [] };
  return {
    queue: {
      ...queue,
      items: queue.items.slice(over),
      index: queue.index - over,
      addedEnd: queue.addedEnd - over,
    },
    dropped: queue.items.slice(0, over).map(({ track }) => track.id),
  };
}

/** What radio itself picked and hasn't played, which it can change its mind about. What the person added stays. */
export function unplayedPickIds({ items, index, addedEnd }: Queue): number[] {
  if (index === null) return [];
  return items.slice(Math.max(index + 1, addedEnd)).map(({ queueId }) => queueId);
}

export function radioWindow({ items, index }: Queue): { past: Track[]; upNext: Track[] } {
  if (index === null) return { past: [], upNext: [] };
  const trackOf = ({ track }: QueuedTrack) => track;
  return {
    past: items.slice(Math.max(index - SHOWN_PAST, 0), index).map(trackOf),
    upNext: items.slice(index + 1, index + 1 + SHOWN_NEXT).map(trackOf),
  };
}
