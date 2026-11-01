import { describe, expect, it } from 'vitest';
import { EMPTY_QUEUE, jumpTo, replaceQueue, type Queue } from './queue';
import { applyTopUp, enterRadio, jumpOverIds, playedSeeds, radioWindow, topUpAsk, topUpSource, trimPast } from './queueTopUp';
import { makePlayable } from './testFixtures';

function queueOf(count: number, index = 0): Queue {
  const tracks = Array.from({ length: count }, (_, at) => makePlayable(at + 1));
  return replaceQueue(EMPTY_QUEUE, tracks, index);
}

describe('Endless', () => {
  it('adds nothing when off', () => {
    const source = topUpSource(false, false);
    expect(source).toBeNull();
    expect(topUpAsk({ queue: queueOf(1), source, canAsk: true })).toBeNull();
  });

  it('adds nothing before the end, however long the list', () => {
    const source = topUpSource(false, true);
    expect(topUpAsk({ queue: queueOf(1000), source, canAsk: true })).toBeNull();
    expect(topUpAsk({ queue: queueOf(3, 0), source, canAsk: true })).toBeNull();
  });

  it('asks for a few when it is about to run out', () => {
    const source = topUpSource(false, true);
    expect(topUpAsk({ queue: queueOf(3, 1), source, canAsk: true })?.count).toBe(3);
    expect(topUpAsk({ queue: queueOf(3, 2), source, canAsk: true })?.count).toBe(4);
  });

  it('asks about one song on its own too', () => {
    expect(topUpAsk({ queue: queueOf(1), source: 'endless', canAsk: true })?.seeds).toEqual([1]);
  });

  it("doesn't ask again once told there's nothing", () => {
    expect(topUpAsk({ queue: queueOf(1), source: 'endless', canAsk: false })).toBeNull();
  });

  it('adds nothing that is not owned', () => {
    const queue = queueOf(1);
    const gone = makePlayable(9, {}, { isMissing: true });
    expect(applyTopUp(queue, [gone])).toBeNull();
    expect(applyTopUp(queue, [gone, makePlayable(8)])?.items.map(({ track }) => track.id)).toEqual([1, 8]);
  });

  it('adds nothing when the engine has no match', () => {
    expect(applyTopUp(queueOf(1), [])).toBeNull();
  });

  it('puts them at the very end, behind what was added by hand', () => {
    const queue = { ...queueOf(2), addedEnd: 2 };
    const topped = applyTopUp(queue, [makePlayable(8)]);
    expect(topped?.items.map(({ track }) => track.id)).toEqual([1, 2, 8]);
    expect(topped?.addedEnd).toBe(2);
  });
});

describe('radio', () => {
  it('keeps several waiting, and asks enough to fill it back up', () => {
    expect(topUpAsk({ queue: queueOf(6, 0), source: 'radio', canAsk: true })).toBeNull();
    expect(topUpAsk({ queue: queueOf(5, 0), source: 'radio', canAsk: true })?.count).toBe(4);
    expect(topUpAsk({ queue: queueOf(1, 0), source: 'radio', canAsk: true })?.count).toBe(8);
  });

  it('leaves what was skipped out of the seeds, and holds it against its artist', () => {
    const queue = queueOf(4, 3);
    const ask = topUpAsk({ queue, source: 'radio', canAsk: true, skipped: [2] });
    expect(ask?.seeds).toEqual([1, 3, 4]);
    expect(ask?.recent).toEqual([1, 2, 3, 4, 2]);
  });

  it('goes by what was skipped only if nothing else played', () => {
    expect(playedSeeds(queueOf(2, 0), [1])).toEqual([1]);
  });

  it('seeds only from the last five played', () => {
    expect(playedSeeds(queueOf(10, 7), [])).toEqual([4, 5, 6, 7, 8]);
  });

  it('never suggests what it has heard or is holding', () => {
    expect(topUpAsk({ queue: queueOf(2), source: 'radio', canAsk: true, heard: [50] })?.exclude).toEqual([50, 1, 2]);
  });

  it('keeps the current item as it is when that carries on', () => {
    const queue = queueOf(3, 1);
    const current = queue.items[1];
    if (current === undefined) throw new Error('no item');
    const radio = enterRadio(queue, { past: null, current, picks: [makePlayable(8), makePlayable(9)] });
    expect(radio.items[0]?.queueId).toBe(current.queueId);
    expect(radio.items.map(({ track }) => track.id)).toEqual([2, 8, 9]);
    expect(radio.index).toBe(0);
    expect(radio.addedEnd).toBe(1);
    expect(new Set(radio.items.map(({ queueId }) => queueId)).size).toBe(3);
  });

  it('puts what was playing behind a track that starts', () => {
    const queue = queueOf(3, 1);
    const radio = enterRadio(queue, { past: makePlayable(2), current: makePlayable(7), picks: [makePlayable(8)] });
    expect(radio.items.map(({ track }) => track.id)).toEqual([2, 7, 8]);
    expect(radio.index).toBe(1);
    expect(radio.nextId).toBeGreaterThan(queue.nextId);
  });

  it('what a jump goes over', () => {
    expect(jumpOverIds(queueOf(5, 0), 3)).toEqual([2, 3]);
    expect(jumpOverIds(queueOf(5, 3), 1)).toEqual([]);
  });

  it('forgets the far past, and remembers it was heard', () => {
    const queue = jumpTo(queueOf(60), 55);
    if (queue === null) throw new Error('no queue');
    const { queue: trimmed, dropped } = trimPast(queue);
    expect(dropped).toEqual([1, 2, 3, 4, 5]);
    expect(trimmed.index).toBe(50);
    expect(trimmed.items[trimmed.index ?? 0]?.track.id).toBe(56);
    expect(trimPast(trimmed).dropped).toEqual([]);
  });

  it('shows a little behind and what is ahead', () => {
    const { past, upNext } = radioWindow(queueOf(30, 10));
    expect(past.map(({ id }) => id)).toEqual([8, 9, 10]);
    expect(upNext.map(({ id }) => id)).toEqual([12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
  });
});
