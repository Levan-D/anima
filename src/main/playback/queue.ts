/* The queue as data: what's in it, in what order, and which item is current. Nothing here knows how anything plays. */

import type { EnqueuePlace } from '@shared/domain';
import type { PlayableTrack } from '@main/library/queries';

/** The queue's own id for an item, so the same track can be in it twice. */
export type QueuedTrack = PlayableTrack & { queueId: number };

export type Queue = {
  items: QueuedTrack[];
  /** Null when nothing is current, which an empty queue can't help. */
  index: number | null;
  /**
   * Where what was added by hand ends: those are the items from just after the current one up to here, and the next one
   * added goes here. Right after the current item when nothing is waiting.
   */
  addedEnd: number;
  /** Never goes back, so an id from before a change can't come to mean something else. */
  nextId: number;
};

export const EMPTY_QUEUE: Queue = { items: [], index: null, addedEnd: 0, nextId: 1 };

function withIds(tracks: PlayableTrack[], firstId: number): QueuedTrack[] {
  return tracks.map((track, offset) => ({ ...track, queueId: firstId + offset }));
}

export function currentItem({ items, index }: Queue): QueuedTrack | null {
  return index === null ? null : (items[index] ?? null);
}

/** Just after the current item. Nothing current counts as just before the first. */
function afterCurrent({ index }: Pick<Queue, 'index'>): number {
  return (index ?? -1) + 1;
}

export function replaceQueue({ nextId }: Queue, tracks: PlayableTrack[], startIndex: number): Queue {
  const index = tracks.length === 0 ? null : Math.min(startIndex, tracks.length - 1);
  return {
    items: withIds(tracks, nextId),
    index,
    addedEnd: afterCurrent({ index }),
    nextId: nextId + tracks.length,
  };
}

/**
 * 'next' goes right after the current item, ahead of everything else waiting. 'after-added' goes behind what's already
 * been added, and ahead of the rest of the list. Both count as added. The index stays on the current item.
 */
export function enqueue(queue: Queue, tracks: PlayableTrack[], place: EnqueuePlace): Queue {
  const added = withIds(tracks, queue.nextId);
  const at = place === 'next' ? afterCurrent(queue) : queue.addedEnd;
  return {
    items: [...queue.items.slice(0, at), ...added, ...queue.items.slice(at)],
    index: queue.index,
    addedEnd: queue.addedEnd + tracks.length,
    nextId: queue.nextId + tracks.length,
  };
}

/** When the current item goes, the one after it takes over. With nothing after it, nothing is current. */
export function removeItems(queue: Queue, queueIds: number[]): Queue {
  const gone = new Set(queueIds);
  const items = queue.items.filter(({ queueId }) => !gone.has(queueId));
  if (items.length === queue.items.length) return queue;

  const end = queue.items.slice(0, queue.addedEnd).filter(({ queueId }) => !gone.has(queueId)).length;
  if (queue.index === null) return { ...queue, items, addedEnd: end };

  const before = queue.items.slice(0, queue.index).filter(({ queueId }) => !gone.has(queueId)).length;
  const index = before < items.length ? before : null;
  return { ...queue, items, index, addedEnd: index === null ? 0 : Math.max(end, index + 1) };
}

/**
 * They end up together, in the order they're in now, starting at `toIndex` counted without them, or last if that's past
 * the end. The current item stays current.
 */
export function moveItems(queue: Queue, queueIds: readonly number[], toIndex: number): Queue {
  const wanted = new Set(queueIds);
  const moving = queue.items.filter((item) => wanted.has(item.queueId));
  if (moving.length === 0) return queue;

  const rest = queue.items.filter((item) => !wanted.has(item.queueId));
  const to = Math.min(toIndex, rest.length);
  const items = [...rest.slice(0, to), ...moving, ...rest.slice(to)];
  if (items.every((item, index) => item === queue.items[index])) return queue;

  const current = queue.index === null ? undefined : queue.items[queue.index];
  const index = current === undefined ? null : items.indexOf(current);
  return { ...queue, items, index, addedEnd: Math.max(addedEndAfterMove(queue, wanted, to), afterCurrent({ index })) };
}

/** Dropped among the added, it's one of them. Dropped behind them, it's not, unless it was one already and only moved within. */
function addedEndAfterMove(queue: Queue, moving: ReadonlySet<number>, to: number): number {
  const inLine = queue.items.slice(0, queue.addedEnd);
  const staying = inLine.filter(({ queueId }) => !moving.has(queueId)).length;
  const added = inLine.slice(afterCurrent(queue));
  const wasAdded = added.some(({ queueId }) => moving.has(queueId));
  return to < staying || (to === staying && wasAdded) ? staying + moving.size : staying;
}

/**
 * Null when there's nothing at that index. What's still waiting keeps waiting from wherever this lands before its end:
 * going back to a track doesn't forget what was added after it. From there on nothing is waiting any more.
 */
export function jumpTo(queue: Queue, index: number): Queue | null {
  if (queue.items[index] === undefined) return null;
  const isWaiting = queue.addedEnd > afterCurrent(queue);
  return { ...queue, index, addedEnd: isWaiting && index < queue.addedEnd ? queue.addedEnd : index + 1 };
}

/** Null when that id isn't in the queue. */
export function jumpToItem(queue: Queue, queueId: number): Queue | null {
  return jumpTo(
    queue,
    queue.items.findIndex((item) => item.queueId === queueId),
  );
}

/** Null at the last item. With nothing current, the first item is what comes next. */
export function stepForward(queue: Queue): Queue | null {
  return jumpTo(queue, queue.index === null ? 0 : queue.index + 1);
}

/** Null at the first item. */
export function stepBack(queue: Queue): Queue | null {
  return queue.index === null ? null : jumpTo(queue, queue.index - 1);
}

export function clearItems({ nextId }: Queue): Queue {
  return { items: [], index: null, addedEnd: 0, nextId };
}

/** A CUE album is one file, so every item from it goes at once. */
export function markFileMissing(queue: Queue, fileId: number): Queue {
  const isAffected = ({ range, track }: QueuedTrack) => range.fileId === fileId && !track.isMissing;
  if (!queue.items.some(isAffected)) return queue;
  return {
    ...queue,
    items: queue.items.map((item) =>
      isAffected(item) ? { ...item, track: { ...item.track, isMissing: true } } : item,
    ),
  };
}
