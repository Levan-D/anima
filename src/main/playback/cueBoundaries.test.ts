import { describe, expect, it } from 'vitest';
import type { TrackRange } from '@main/library/queries';
import { clampSeek, indexAtPosition, isContiguous, isPartOfFile, runFrom, type RangedItem } from './cueBoundaries';

const range = (fileId: number, startMs: number, endMs: number | null): TrackRange => ({ fileId, startMs, endMs });

const items = (...ranges: TrackRange[]): RangedItem[] =>
  ranges.map((itemRange, index) => ({ queueId: index + 10, track: { id: index + 1 }, range: itemRange }));

describe('isContiguous', () => {
  it('is true when one range starts where the other ends, in the same file', () => {
    expect(isContiguous(range(1, 0, 1000), range(1, 1000, 2000))).toBe(true);
  });

  it('is false across files, whatever the times say', () => {
    expect(isContiguous(range(1, 0, 1000), range(2, 1000, 2000))).toBe(false);
  });

  it('is false with a gap, or going backwards', () => {
    expect(isContiguous(range(1, 0, 1000), range(1, 1500, 2000))).toBe(false);
    expect(isContiguous(range(1, 1000, 2000), range(1, 0, 1000))).toBe(false);
  });

  it('is false for whole files, including the same one twice', () => {
    expect(isContiguous(range(1, 0, null), range(1, 0, null))).toBe(false);
  });
});

describe('isPartOfFile', () => {
  it('tells a range from a whole file', () => {
    expect(isPartOfFile(range(1, 0, null))).toBe(false);
    expect(isPartOfFile(range(1, 0, 1000))).toBe(true);
    expect(isPartOfFile(range(1, 1000, null))).toBe(true);
  });
});

describe('runFrom', () => {
  it('is one item for a whole file', () => {
    expect(runFrom(items(range(1, 0, null), range(2, 0, null)), 0)).toEqual({
      queueIds: [10],
      firstQueueId: 10,
      trackId: 1,
      fileId: 1,
      startMs: 0,
      endMs: null,
    });
  });

  it('takes in everything contiguous, and stops at the last one’s end', () => {
    const queue = items(range(1, 0, 1000), range(1, 1000, 2000), range(1, 2000, 3000), range(2, 0, null));
    expect(runFrom(queue, 0)).toMatchObject({ queueIds: [10, 11, 12], startMs: 0, endMs: 3000 });
  });

  it('starts from where it was asked to', () => {
    const queue = items(range(1, 0, 1000), range(1, 1000, 2000), range(1, 2000, null));
    expect(runFrom(queue, 1)).toMatchObject({ queueIds: [11, 12], trackId: 2, startMs: 1000, endMs: null });
  });

  it('stops at a gap', () => {
    const queue = items(range(1, 0, 1000), range(1, 1500, 2000));
    expect(runFrom(queue, 0)).toMatchObject({ queueIds: [10], endMs: 1000 });
  });

  it('is null past the end', () => {
    expect(runFrom(items(range(1, 0, null)), 1)).toBeNull();
  });
});

describe('indexAtPosition', () => {
  const queue = items(range(1, 0, 1000), range(1, 1000, 2000), range(1, 2000, 3000), range(2, 0, null));

  it('stays put inside the range', () => {
    expect(indexAtPosition(queue, 0, 999)).toBe(0);
  });

  it('moves on the moment the position reaches the next range', () => {
    expect(indexAtPosition(queue, 0, 1000)).toBe(1);
  });

  it('crosses several at once when ticks are far apart', () => {
    expect(indexAtPosition(queue, 0, 2500)).toBe(2);
  });

  it('never leaves the stretch: another file is a real transition', () => {
    expect(indexAtPosition(queue, 2, 9000)).toBe(2);
  });

  it('never moves back: a seek back has its own command', () => {
    expect(indexAtPosition(queue, 1, 100)).toBe(1);
  });

  it('leaves a whole file alone', () => {
    expect(indexAtPosition(items(range(1, 0, null), range(2, 0, null)), 0, 99_999)).toBe(0);
  });
});

describe('clampSeek', () => {
  it('leaves anything well inside the track alone', () => {
    expect(clampSeek(1000, 200_000)).toBe(1000);
    expect(clampSeek(199_500, 200_000)).toBe(199_500);
  });

  it('holds anything within half a second of the end to half a second before it', () => {
    expect(clampSeek(199_501, 200_000)).toBe(199_500);
    expect(clampSeek(200_000, 200_000)).toBe(199_500);
    expect(clampSeek(999_999, 200_000)).toBe(199_500);
  });

  it('goes to the start of a track too short to do that', () => {
    expect(clampSeek(100, 300)).toBe(0);
  });

  it('never goes below zero', () => {
    expect(clampSeek(-5, 200_000)).toBe(0);
  });
});
