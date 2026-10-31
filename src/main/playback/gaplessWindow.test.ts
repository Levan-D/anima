import { describe, expect, it } from 'vitest';
import type { TrackRange } from '@main/library/queries';
import type { RangedItem } from './cueBoundaries';
import { endOption, fileOptions, NOTHING_HELD, planWindow, type Held, type HeldEntry } from './gaplessWindow';

/** Queue ids are 11, 12, 13… and track ids 1, 2, 3…, so a position in the list is easy to read off. */
function queue(...ranges: Partial<TrackRange>[]): RangedItem[] {
  return ranges.map((range, index) => ({
    queueId: index + 11,
    track: { id: index + 1 },
    range: { fileId: index + 1, startMs: 0, endMs: null, ...range },
  }));
}

const wholeFiles = (count: number) => queue(...Array.from({ length: count }, () => ({})));

function entry(entryId: number, queueId: number, overrides: Partial<HeldEntry> = {}): HeldEntry {
  return { entryId, queueId, fileId: queueId - 10, endMs: null, ...overrides };
}

function held(entries: HeldEntry[], playingId: number | null, overrides: Partial<Held> = {}): Held {
  const playing = entries.find(({ entryId }) => entryId === playingId);
  return { ...NOTHING_HELD, entries, playingId, atQueueId: playing?.queueId ?? null, isLoaded: true, ...overrides };
}

const replace = (queueIds: number[], startMs = 0, endMs: number | null = null) => ({
  kind: 'load',
  mode: 'replace',
  run: expect.objectContaining({ queueIds, startMs, endMs }) as unknown,
});
const append = (queueIds: number[], startMs = 0, endMs: number | null = null) => ({
  kind: 'load',
  mode: 'append',
  run: expect.objectContaining({ queueIds, startMs, endMs }) as unknown,
});

describe('planWindow', () => {
  it('holds nothing when nothing should play', () => {
    expect(planWindow(wholeFiles(2), null, NOTHING_HELD)).toEqual([]);
  });

  it('stops what is held when nothing should play', () => {
    expect(planWindow(wholeFiles(2), null, held([entry(1, 11)], 1))).toEqual([{ kind: 'stop' }]);
    // Finished by itself, so mpv's already idle, but its list still has the entry in it.
    expect(planWindow(wholeFiles(2), null, held([entry(1, 11)], null))).toEqual([{ kind: 'stop' }]);
  });

  it('loads the current item and the next from nothing', () => {
    expect(planWindow(wholeFiles(3), 0, NOTHING_HELD)).toEqual([replace([11]), append([12])]);
  });

  it('loads only the current item when it is the last', () => {
    expect(planWindow(wholeFiles(2), 1, NOTHING_HELD)).toEqual([replace([12])]);
  });

  it('asks for nothing when mpv already holds the right two', () => {
    expect(planWindow(wholeFiles(3), 0, held([entry(1, 11), entry(2, 12)], 1))).toEqual([]);
  });

  it('asks for nothing while mpv is moving on by itself', () => {
    expect(planWindow(wholeFiles(3), 0, held([entry(1, 11), entry(2, 12)], null, { isMovingOn: true }))).toEqual([]);
  });

  it('after a transition, trims what ended and tops up the next', () => {
    expect(planWindow(wholeFiles(3), 1, held([entry(1, 11), entry(2, 12)], 2))).toEqual([
      { kind: 'remove', index: 0 },
      append([13]),
    ]);
  });

  it('at the last item, only trims', () => {
    expect(planWindow(wholeFiles(2), 1, held([entry(1, 11), entry(2, 12)], 2))).toEqual([{ kind: 'remove', index: 0 }]);
  });

  it('moves with playlist-next when the item is the next one held', () => {
    expect(planWindow(wholeFiles(3), 1, held([entry(1, 11), entry(2, 12)], 1))).toEqual([{ kind: 'next' }]);
  });

  it('replaces when the item is not held', () => {
    expect(planWindow(wholeFiles(4), 2, held([entry(1, 11), entry(2, 12)], 1))).toEqual([replace([13]), append([14])]);
  });

  it('replaces to go back, since nothing behind the current item is held', () => {
    expect(planWindow(wholeFiles(3), 0, held([entry(1, 12), entry(2, 13)], 1))).toEqual([replace([11]), append([12])]);
  });

  it('re-syncs the next without touching what is playing', () => {
    const items = queue({}, { fileId: 9 }, {});
    const inserted = [items[0], { ...items[1], queueId: 99 }, items[2]] as RangedItem[];
    expect(planWindow(inserted, 0, held([entry(1, 11), entry(2, 12)], 1))).toEqual([
      { kind: 'remove', index: 1 },
      append([99]),
    ]);
  });

  it('removes the next when nothing comes after the current item any more', () => {
    expect(planWindow(wholeFiles(1), 0, held([entry(1, 11), entry(2, 12)], 1))).toEqual([{ kind: 'remove', index: 1 }]);
  });

  it('removes from the far end first, so the indexes hold', () => {
    const entries = [entry(1, 90), entry(2, 91), entry(3, 11), entry(4, 92), entry(5, 12)];
    expect(planWindow(wholeFiles(2), 0, held(entries, 3))).toEqual([
      { kind: 'remove', index: 4 },
      { kind: 'remove', index: 3 },
      { kind: 'remove', index: 1 },
      { kind: 'remove', index: 0 },
      append([12]),
    ]);
  });

  it('leaves out a next item that can’t be held, and does not try the one after it', () => {
    const canHold = ({ queueId }: RangedItem) => queueId !== 12;
    expect(planWindow(wholeFiles(3), 0, NOTHING_HELD, canHold)).toEqual([replace([11])]);
    expect(planWindow(wholeFiles(3), 0, held([entry(1, 11)], 1), canHold)).toEqual([]);
  });

  it('treats the same track queued twice as two things', () => {
    const items = queue({ fileId: 1 }, { fileId: 1 });
    expect(planWindow(items, 1, held([entry(1, 11, { fileId: 1 }), entry(2, 12, { fileId: 1 })], 1))).toEqual([
      { kind: 'next' },
    ]);
  });
});

describe('planWindow with CUE ranges', () => {
  const album = () =>
    queue(
      { fileId: 1, startMs: 0, endMs: 1000 },
      { fileId: 1, startMs: 1000, endMs: 2000 },
      { fileId: 1, startMs: 2000, endMs: null },
      { fileId: 2 },
    );

  it('loads a contiguous stretch as one entry, with nothing to stop it early', () => {
    expect(planWindow(album(), 0, NOTHING_HELD)).toEqual([replace([11, 12, 13]), append([14])]);
  });

  it('sets end when what comes next in the queue is not contiguous', () => {
    const items = queue({ fileId: 1, startMs: 0, endMs: 1000 }, { fileId: 2 });
    expect(planWindow(items, 0, NOTHING_HELD)).toEqual([replace([11], 0, 1000), append([12])]);
  });

  it('sets end at the end of the stretch, not its first track', () => {
    const items = queue(
      { fileId: 1, startMs: 0, endMs: 1000 },
      { fileId: 1, startMs: 1000, endMs: 2000 },
      { fileId: 2 },
    );
    expect(planWindow(items, 0, NOTHING_HELD)).toEqual([replace([11, 12], 0, 2000), append([13])]);
  });

  it('loads a track from further on in the file from its own start', () => {
    expect(planWindow(album(), 1, NOTHING_HELD)).toEqual([replace([12, 13], 1000, null), append([14])]);
  });

  it('asks for nothing when a boundary is crossed, since the same entry plays on', () => {
    const entries = [entry(1, 11, { fileId: 1 }), entry(2, 14, { fileId: 2 })];
    expect(planWindow(album(), 1, held(entries, 1, { atQueueId: 12 }))).toEqual([]);
  });

  it('seeks to go back within the file', () => {
    const entries = [entry(1, 11, { fileId: 1 }), entry(2, 14, { fileId: 2 })];
    expect(planWindow(album(), 0, held(entries, 1, { atQueueId: 12 }))).toEqual([
      { kind: 'seek', queueId: 11, fileMs: 0 },
    ]);
  });

  it('seeks to go forward within the file', () => {
    const entries = [entry(1, 11, { fileId: 1 }), entry(2, 14, { fileId: 2 })];
    expect(planWindow(album(), 2, held(entries, 1, { atQueueId: 11 }))).toEqual([
      { kind: 'seek', queueId: 13, fileMs: 2000 },
    ]);
  });

  it('clears end before a seek, so mpv can’t stop at it on the way', () => {
    const items = queue({ fileId: 1, startMs: 0, endMs: 1000 }, { fileId: 1, startMs: 2000, endMs: 3000 });
    const entries = [entry(1, 11, { fileId: 1, endMs: 1000 })];
    expect(planWindow(items, 1, held(entries, 1))).toEqual([
      { kind: 'set-end', endMs: null },
      { kind: 'seek', queueId: 12, fileMs: 2000 },
    ]);
  });

  it('replaces instead of seeking while the file is not open yet', () => {
    const entries = [entry(1, 11, { fileId: 1 }), entry(2, 14, { fileId: 2 })];
    expect(planWindow(album(), 1, held(entries, 1, { isLoaded: false }))).toEqual([
      replace([12, 13], 1000),
      append([14]),
    ]);
  });

  it('moves end when the track after it is taken away', () => {
    const items = queue({ fileId: 1, startMs: 0, endMs: 1000 }, { fileId: 2 });
    const entries = [entry(1, 11, { fileId: 1, endMs: null }), entry(2, 12)];
    expect(planWindow(items, 0, held(entries, 1))).toEqual([{ kind: 'set-end', endMs: 1000 }]);
  });

  it('clears end when a contiguous track is put back after it', () => {
    const items = queue({ fileId: 1, startMs: 0, endMs: 1000 }, { fileId: 1, startMs: 1000, endMs: null });
    const entries = [entry(1, 11, { fileId: 1, endMs: 1000 })];
    expect(planWindow(items, 0, held(entries, 1))).toEqual([{ kind: 'set-end', endMs: null }]);
  });

  it('replaces the next entry when it would stop in the wrong place', () => {
    const items = queue({ fileId: 2 }, { fileId: 1, startMs: 0, endMs: 1000 }, { fileId: 3 });
    const entries = [entry(1, 11, { fileId: 2 }), entry(2, 12, { fileId: 1, endMs: null })];
    expect(planWindow(items, 0, held(entries, 1))).toEqual([{ kind: 'remove', index: 1 }, append([12], 0, 1000)]);
  });

  it('treats another stretch of the file that is the next entry as the next entry', () => {
    const items = queue({ fileId: 1, startMs: 0, endMs: 1000 }, { fileId: 1, startMs: 5000, endMs: 6000 });
    const entries = [entry(1, 11, { fileId: 1, endMs: 1000 }), entry(2, 12, { fileId: 1, endMs: 6000 })];
    expect(planWindow(items, 1, held(entries, 1))).toEqual([{ kind: 'next' }]);
  });
});

describe('fileOptions', () => {
  it('says nothing for a whole file from the top', () => {
    expect(fileOptions({ startMs: 0, endMs: null })).toBe('');
  });

  it('says where to start and stop, in seconds', () => {
    expect(fileOptions({ startMs: 1500, endMs: null })).toBe('start=1.500');
    expect(fileOptions({ startMs: 0, endMs: 61_250 })).toBe('end=61.250');
    expect(fileOptions({ startMs: 1500, endMs: 61_250 })).toBe('start=1.500,end=61.250');
  });
});

describe('endOption', () => {
  it('says where to stop, or that it should not', () => {
    expect(endOption(1500)).toBe('1.500');
    expect(endOption(null)).toBe('none');
  });
});
