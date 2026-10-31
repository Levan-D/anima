import { describe, expect, it } from 'vitest';
import {
  clearItems,
  currentItem,
  EMPTY_QUEUE,
  enqueue,
  jumpTo,
  jumpToItem,
  markFileMissing,
  moveItems,
  removeItems,
  replaceQueue,
  stepBack,
  stepForward,
  type Queue,
} from './queue';
import { makePlayable } from './testFixtures';

const tracks = (...ids: number[]) => ids.map((id) => makePlayable(id));
const queueOf = (ids: number[], index = 0) => replaceQueue(EMPTY_QUEUE, tracks(...ids), index);
const order = (queue: Queue) => queue.items.map(({ track }) => track.id);
const currentTrack = (queue: Queue | null) => (queue === null ? null : (currentItem(queue)?.track.id ?? null));
const idOf = (queue: Queue, position: number) => queue.items[position]?.queueId ?? -1;

describe('replaceQueue', () => {
  it('starts where it was told, keeping the order', () => {
    const queue = queueOf([7, 8, 9], 1);
    expect(order(queue)).toEqual([7, 8, 9]);
    expect(currentTrack(queue)).toBe(8);
  });

  it('gives a track that repeats its own id each time', () => {
    const queue = queueOf([7, 7, 7]);
    expect(new Set(queue.items.map(({ queueId }) => queueId)).size).toBe(3);
  });

  it('never hands out an id it used before', () => {
    const first = queueOf([1, 2]);
    const second = replaceQueue(first, tracks(3, 4), 0);
    const ids = [...first.items, ...second.items].map(({ queueId }) => queueId);
    expect(new Set(ids).size).toBe(4);
    expect(clearItems(second).nextId).toBe(second.nextId);
  });

  it('keeps a start past the end on the last track', () => {
    expect(currentTrack(queueOf([1, 2], 9))).toBe(2);
  });

  it('has nothing current when there is nothing', () => {
    expect(replaceQueue(EMPTY_QUEUE, [], 0).index).toBeNull();
  });
});

describe('enqueue', () => {
  it('puts next right after the current item, in the order given, and stays on it', () => {
    const queue = enqueue(queueOf([1, 2, 3], 1), tracks(8, 9), 'next');
    expect(order(queue)).toEqual([1, 2, 8, 9, 3]);
    expect(currentTrack(queue)).toBe(2);
  });

  it('puts next at the front when nothing is current', () => {
    const queue = enqueue({ ...queueOf([1, 2]), index: null }, tracks(9), 'next');
    expect(order(queue)).toEqual([9, 1, 2]);
    expect(queue.index).toBeNull();
  });

  it('puts end at the end, and leaves the index alone', () => {
    const queue = enqueue(queueOf([1, 2, 3], 1), tracks(9), 'end');
    expect(order(queue)).toEqual([1, 2, 3, 9]);
    expect(queue.index).toBe(1);
  });

  it('adds to an empty queue without making anything current', () => {
    const queue = enqueue(EMPTY_QUEUE, tracks(1, 2), 'end');
    expect(order(queue)).toEqual([1, 2]);
    expect(queue.index).toBeNull();
  });
});

describe('removeItems', () => {
  it('keeps the current item current when something before it goes', () => {
    const queue = queueOf([1, 2, 3, 4], 2);
    const after = removeItems(queue, [idOf(queue, 0)]);
    expect(order(after)).toEqual([2, 3, 4]);
    expect(currentTrack(after)).toBe(3);
    expect(after.index).toBe(1);
  });

  it('leaves the index alone when something after it goes', () => {
    const queue = queueOf([1, 2, 3, 4], 1);
    const after = removeItems(queue, [idOf(queue, 3)]);
    expect(after.index).toBe(1);
  });

  it('moves on to the next one when the current item goes', () => {
    const queue = queueOf([1, 2, 3], 1);
    const after = removeItems(queue, [idOf(queue, 1)]);
    expect(currentTrack(after)).toBe(3);
  });

  it('skips over the next ones when they go with it', () => {
    const queue = queueOf([1, 2, 3, 4], 1);
    const after = removeItems(queue, [idOf(queue, 1), idOf(queue, 2)]);
    expect(currentTrack(after)).toBe(4);
  });

  it('has nothing current when the last one goes and it was current', () => {
    const queue = queueOf([1, 2, 3], 2);
    const after = removeItems(queue, [idOf(queue, 2)]);
    expect(order(after)).toEqual([1, 2]);
    expect(after.index).toBeNull();
  });

  it('removes one copy of a track and not the other', () => {
    const queue = queueOf([1, 1, 1], 2);
    const after = removeItems(queue, [idOf(queue, 0)]);
    expect(after.items).toHaveLength(2);
    expect(after.index).toBe(1);
  });

  it('changes nothing for ids it has never heard of', () => {
    const queue = queueOf([1, 2], 1);
    expect(removeItems(queue, [999])).toBe(queue);
  });
});

describe('moveItems', () => {
  it('takes several together, in their order, wherever they were', () => {
    const queue = queueOf([1, 2, 3, 4, 5], 1);
    const moved = moveItems(queue, [idOf(queue, 2), idOf(queue, 0)], 2);
    expect(order(moved)).toEqual([2, 4, 1, 3, 5]);
    expect(currentTrack(moved)).toBe(2);
  });

  it('leaves a queue alone when they are there already', () => {
    const queue = queueOf([1, 2, 3], 0);
    expect(moveItems(queue, [idOf(queue, 1), idOf(queue, 2)], 1)).toBe(queue);
  });

  it('moves an item to the place it was told', () => {
    const queue = queueOf([1, 2, 3, 4]);
    expect(order(moveItems(queue, [idOf(queue, 0)], 2))).toEqual([2, 3, 1, 4]);
    expect(order(moveItems(queue, [idOf(queue, 3)], 1))).toEqual([1, 4, 2, 3]);
  });

  it('keeps the moved item current when it was', () => {
    const queue = queueOf([1, 2, 3, 4], 1);
    expect(moveItems(queue, [idOf(queue, 1)], 3).index).toBe(3);
    expect(currentTrack(moveItems(queue, [idOf(queue, 1)], 3))).toBe(2);
  });

  it('keeps the current item current when another moves across it', () => {
    const queue = queueOf([1, 2, 3, 4], 2);
    const forward = moveItems(queue, [idOf(queue, 0)], 3);
    expect(currentTrack(forward)).toBe(3);
    expect(forward.index).toBe(1);

    const back = moveItems(queue, [idOf(queue, 3)], 0);
    expect(currentTrack(back)).toBe(3);
    expect(back.index).toBe(3);
  });

  it('leaves the index alone when the move stays on one side of it', () => {
    const queue = queueOf([1, 2, 3, 4, 5], 2);
    expect(moveItems(queue, [idOf(queue, 3)], 4).index).toBe(2);
    expect(moveItems(queue, [idOf(queue, 0)], 1).index).toBe(2);
  });

  it('keeps a place past the end to the end', () => {
    const queue = queueOf([1, 2, 3]);
    expect(order(moveItems(queue, [idOf(queue, 0)], 99))).toEqual([2, 3, 1]);
  });

  it('changes nothing for an id it has never heard of', () => {
    const queue = queueOf([1, 2]);
    expect(moveItems(queue, [999], 0)).toBe(queue);
  });
});

describe('moving through it', () => {
  it('steps forward until there is nothing more', () => {
    const queue = queueOf([1, 2]);
    const second = stepForward(queue);
    expect(currentTrack(second)).toBe(2);
    expect(stepForward(second as Queue)).toBeNull();
  });

  it('starts at the top when nothing was current', () => {
    expect(currentTrack(stepForward({ ...queueOf([1, 2]), index: null }))).toBe(1);
  });

  it('has nowhere to go when empty', () => {
    expect(stepForward(EMPTY_QUEUE)).toBeNull();
    expect(stepBack(EMPTY_QUEUE)).toBeNull();
  });

  it('steps back until there is nothing more', () => {
    const queue = queueOf([1, 2], 1);
    const first = stepBack(queue);
    expect(currentTrack(first)).toBe(1);
    expect(stepBack(first as Queue)).toBeNull();
  });

  it('jumps to an index, or says there is nothing there', () => {
    const queue = queueOf([1, 2, 3]);
    expect(currentTrack(jumpTo(queue, 2))).toBe(3);
    expect(jumpTo(queue, 3)).toBeNull();
    expect(jumpTo(queue, -1)).toBeNull();
  });

  it('jumps to an item by its id, or says it is not there', () => {
    const queue = queueOf([1, 2, 3]);
    expect(currentTrack(jumpToItem(queue, idOf(queue, 1)))).toBe(2);
    expect(jumpToItem(queue, 999)).toBeNull();
  });
});

describe('markFileMissing', () => {
  it('marks everything from that file, and only that', () => {
    const queue = replaceQueue(
      EMPTY_QUEUE,
      [makePlayable(1, { fileId: 5 }), makePlayable(2, { fileId: 5 }), makePlayable(3, { fileId: 6 })],
      0,
    );
    const after = markFileMissing(queue, 5);
    expect(after.items.map(({ track }) => track.isMissing)).toEqual([true, true, false]);
    expect(queue.items[0]?.track.isMissing).toBe(false);
  });

  it('changes nothing when they already are, or it has none of them', () => {
    const queue = replaceQueue(EMPTY_QUEUE, [makePlayable(1, { fileId: 5 }, { isMissing: true })], 0);
    expect(markFileMissing(queue, 5)).toBe(queue);
    expect(markFileMissing(queue, 9)).toBe(queue);
  });
});
