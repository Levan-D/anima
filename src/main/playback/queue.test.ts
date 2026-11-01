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
  restoreQueue,
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

describe('restoreQueue', () => {
  const restored = (ids: (number | null)[], index: number | null, addedEnd: number) =>
    restoreQueue(
      EMPTY_QUEUE,
      ids.map((id) => (id === null ? null : makePlayable(id))),
      index,
      addedEnd,
    );

  it('comes back as it was', () => {
    const queue = restored([1, 2, 3, 4], 1, 3);
    expect(order(queue)).toEqual([1, 2, 3, 4]);
    expect(queue).toMatchObject({ index: 1, addedEnd: 3 });
  });

  it('keeps the current item and the added section in place around what has gone', () => {
    const queue = restored([null, 2, 3, null, 5], 2, 4);
    expect(order(queue)).toEqual([2, 3, 5]);
    expect(currentTrack(queue)).toBe(3);
    expect(queue.addedEnd).toBe(2);
  });

  it('moves on to the next that exists when the current one has gone', () => {
    expect(currentTrack(restored([1, null, null, 4], 1, 2))).toBe(4);
  });

  it('has nothing current when nothing is left after it', () => {
    const queue = restored([1, null], 1, 2);
    expect(order(queue)).toEqual([1]);
    expect(queue).toMatchObject({ index: null, addedEnd: 0 });
    expect(restored([null, null], 0, 1).items).toEqual([]);
  });

  it('never reuses an id', () => {
    const later = restoreQueue({ ...EMPTY_QUEUE, nextId: 40 }, [makePlayable(1)], 0, 1);
    expect(later.items[0]?.queueId).toBe(40);
    expect(later.nextId).toBe(41);
  });
});

describe('enqueue', () => {
  it('puts next right after the current item, in the order given, and stays on it', () => {
    const queue = enqueue(queueOf([1, 2, 3], 1), tracks(8, 9), 'next');
    expect(order(queue)).toEqual([1, 2, 8, 9, 3]);
    expect(currentTrack(queue)).toBe(2);
  });

  it('puts next at the front when nothing is current', () => {
    const queue = enqueue({ ...queueOf([1, 2]), index: null, addedEnd: 0 }, tracks(9), 'next');
    expect(order(queue)).toEqual([9, 1, 2]);
    expect(queue.index).toBeNull();
  });

  it('adds to an empty queue without making anything current', () => {
    const queue = enqueue(EMPTY_QUEUE, tracks(1, 2), 'after-added');
    expect(order(queue)).toEqual([1, 2]);
    expect(queue.index).toBeNull();
  });
});

const A = 1;
const B = 2;
const C = 3;
const X = 8;
const Y = 9;
const Z = 10;
const P = 11;

/** A playing, then B and C from the album, and whatever's been added. */
const albumWith = (...added: number[]) =>
  added.reduce((queue, id) => enqueue(queue, tracks(id), 'after-added'), queueOf([A, B, C], 0));

const addedOf = (queue: Queue) => {
  const from = (queue.index ?? -1) + 1;
  return order(queue).slice(from, queue.addedEnd);
};

describe('what was added by hand', () => {
  it('lines up after the current track and ahead of the album, in order', () => {
    const queue = albumWith(X, Y);
    expect(order(queue)).toEqual([A, X, Y, B, C]);
    expect(currentTrack(queue)).toBe(A);
    expect(addedOf(queue)).toEqual([X, Y]);
  });

  it('takes a selection together, in order', () => {
    const queue = enqueue(albumWith(X), tracks(Y, Z), 'after-added');
    expect(order(queue)).toEqual([A, X, Y, Z, B, C]);
  });

  it('lets Play next jump to the very front, and counts it in the line', () => {
    const queue = enqueue(albumWith(X, Y), tracks(P), 'next');
    expect(order(queue)).toEqual([A, P, X, Y, B, C]);
    expect(addedOf(queue)).toEqual([P, X, Y]);
    expect(order(enqueue(queue, tracks(Z), 'after-added'))).toEqual([A, P, X, Y, Z, B, C]);
  });

  it('keeps Play next in the order it was asked for, each ahead of the last', () => {
    const queue = enqueue(enqueue(queueOf([A, B]), tracks(X), 'next'), tracks(Y), 'next');
    expect(order(queue)).toEqual([A, Y, X, B]);
  });

  it('lines up from the front when nothing is current', () => {
    const start = { ...queueOf([A, B]), index: null, addedEnd: 0 };
    expect(order(enqueue(enqueue(start, tracks(X), 'after-added'), tracks(Y), 'after-added'))).toEqual([X, Y, A, B]);
  });

  describe('as it plays through', () => {
    it('shortens, and what is added next still goes behind what is left', () => {
      const second = stepForward(albumWith(X, Y)) as Queue;
      expect(currentTrack(second)).toBe(X);
      expect(addedOf(second)).toEqual([Y]);
      expect(order(enqueue(second, tracks(Z), 'after-added'))).toEqual([A, X, Y, Z, B, C]);
    });

    it('is empty once played through, and the next one added goes right after the current track', () => {
      const third = stepForward(stepForward(albumWith(X, Y)) as Queue) as Queue;
      expect(addedOf(third)).toEqual([]);
      expect(order(enqueue(third, tracks(Z), 'after-added'))).toEqual([A, X, Y, Z, B, C]);
      const fourth = stepForward(third) as Queue;
      expect(currentTrack(fourth)).toBe(B);
      expect(order(enqueue(fourth, tracks(Z), 'after-added'))).toEqual([A, X, Y, B, Z, C]);
    });

    it('is forgotten when something past it is jumped to', () => {
      const jumped = jumpTo(albumWith(X, Y), 3) as Queue;
      expect(currentTrack(jumped)).toBe(B);
      expect(addedOf(jumped)).toEqual([]);
      expect(order(enqueue(jumped, tracks(Z), 'after-added'))).toEqual([A, X, Y, B, Z, C]);
    });

    it('keeps the rest when a skip lands inside it', () => {
      const jumped = jumpTo(albumWith(X, Y, Z), 2) as Queue;
      expect(currentTrack(jumped)).toBe(Y);
      expect(addedOf(jumped)).toEqual([Z]);
    });

    it('survives going back while some of it is left', () => {
      const second = stepForward(albumWith(X, Y)) as Queue;
      const back = stepBack(second) as Queue;
      expect(currentTrack(back)).toBe(A);
      expect(order(enqueue(back, tracks(Z), 'after-added'))).toEqual([A, X, Y, Z, B, C]);
    });

    it('goes right after the track gone back to when nothing was left', () => {
      const queue = queueOf([A, B, C], 2);
      const back = jumpTo(queue, 0) as Queue;
      expect(order(enqueue(back, tracks(X), 'after-added'))).toEqual([A, X, B, C]);
    });

    it('starts the same way when the track is played again from its own row', () => {
      const queue = albumWith(X);
      const again = jumpTo(queue, 0) as Queue;
      expect(addedOf(again)).toEqual([X]);
      expect(order(enqueue(again, tracks(Y), 'after-added'))).toEqual([A, X, Y, B, C]);
    });

    it('can hold the same track more than once, and tell them apart', () => {
      const queue = albumWith(B, B);
      expect(order(queue)).toEqual([A, B, B, B, C]);
      expect(addedOf(removeItems(queue, [idOf(queue, 1)]))).toEqual([B]);
    });
  });

  describe('when something is removed', () => {
    it('gets shorter by what left it', () => {
      const queue = albumWith(X, Y);
      const after = removeItems(queue, [idOf(queue, 1)]);
      expect(addedOf(after)).toEqual([Y]);
      expect(order(enqueue(after, tracks(Z), 'after-added'))).toEqual([A, Y, Z, B, C]);
    });

    it('stays as it is when what goes is from the album', () => {
      const queue = albumWith(X);
      const after = removeItems(queue, [idOf(queue, 2)]);
      expect(addedOf(after)).toEqual([X]);
      expect(order(enqueue(after, tracks(Z), 'after-added'))).toEqual([A, X, Z, C]);
    });

    it('moves up when something before the current track goes', () => {
      const second = stepForward(albumWith(X, Y)) as Queue;
      const after = removeItems(second, [idOf(second, 0)]);
      expect(currentTrack(after)).toBe(X);
      expect(addedOf(after)).toEqual([Y]);
    });

    it('moves on with the rest when the current track goes', () => {
      const queue = albumWith(X, Y);
      const after = removeItems(queue, [idOf(queue, 0)]);
      expect(currentTrack(after)).toBe(X);
      expect(addedOf(after)).toEqual([Y]);
    });

    it('starts again right after the current track when the album takes over from a removed one', () => {
      const queue = queueOf([A, B, C], 0);
      const after = removeItems(queue, [idOf(queue, 0)]);
      expect(currentTrack(after)).toBe(B);
      expect(order(enqueue(after, tracks(X), 'after-added'))).toEqual([B, X, C]);
    });

    it('has nothing left when the last current track goes', () => {
      const queue = queueOf([A, B], 1);
      const after = removeItems(queue, [idOf(queue, 1)]);
      expect(after.index).toBeNull();
      expect(after.addedEnd).toBe(0);
    });
  });

  describe('when something is moved', () => {
    it('reorders within, keeping them all in it', () => {
      const queue = albumWith(X, Y);
      const after = moveItems(queue, [idOf(queue, 1)], 2);
      expect(order(after)).toEqual([A, Y, X, B, C]);
      expect(addedOf(after)).toEqual([Y, X]);
    });

    it('drops out when moved behind it, into the album', () => {
      const queue = albumWith(X, Y);
      const after = moveItems(queue, [idOf(queue, 1)], 3);
      expect(order(after)).toEqual([A, Y, B, X, C]);
      expect(addedOf(after)).toEqual([Y]);
    });

    it('takes in what is dropped among it', () => {
      const queue = albumWith(X, Y);
      const after = moveItems(queue, [idOf(queue, 4)], 2);
      expect(order(after)).toEqual([A, X, C, Y, B]);
      expect(addedOf(after)).toEqual([X, C, Y]);
    });

    it('leaves out what is dropped just behind it from the album', () => {
      const queue = albumWith(X);
      const after = moveItems(queue, [idOf(queue, 3)], 2);
      expect(order(after)).toEqual([A, X, C, B]);
      expect(addedOf(after)).toEqual([X]);
    });

    it('never ends before the current track, wherever that goes', () => {
      const queue = albumWith(X, Y);
      const after = moveItems(queue, [idOf(queue, 0)], 4);
      expect(order(after)).toEqual([X, Y, B, C, A]);
      expect(currentTrack(after)).toBe(A);
      expect(addedOf(after)).toEqual([]);
      expect(order(enqueue(after, tracks(Z), 'after-added'))).toEqual([X, Y, B, C, A, Z]);
    });

    it('keeps its end in the right place when something from before the current track moves', () => {
      const second = stepForward(albumWith(X, Y)) as Queue;
      const after = moveItems(second, [idOf(second, 0)], 4);
      expect(order(after)).toEqual([X, Y, B, C, A]);
      expect(currentTrack(after)).toBe(X);
      expect(addedOf(after)).toEqual([Y]);
    });
  });

  it('goes with the old queue when the queue is replaced or cleared', () => {
    const queue = albumWith(X, Y);
    const replaced = replaceQueue(queue, tracks(4, 5, 6), 1);
    expect(addedOf(replaced)).toEqual([]);
    expect(order(enqueue(replaced, tracks(Z), 'after-added'))).toEqual([4, 5, Z, 6]);
    expect(clearItems(queue).addedEnd).toBe(0);
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
