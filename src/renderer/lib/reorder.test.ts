import { describe, expect, it } from 'vitest';
import { gapAt, gapToIndex, isSamePlace } from '@/lib/reorder';

const ROWS = [
  { index: 4, top: 100, height: 50 },
  { index: 5, top: 150, height: 50 },
  { index: 6, top: 200, height: 50 },
];

describe('gapAt', () => {
  it.each([
    ['above what is on screen', 0, 4],
    ['the top half of a row is above it', 110, 4],
    ['the bottom half of a row is below it', 130, 5],
    ['the last row', 240, 7],
    ['below everything', 900, 7],
  ])('%s', (_name, y, gap) => {
    expect(gapAt(ROWS, y)).toBe(gap);
  });

  it('nothing on screen is no gap', () => {
    expect(gapAt([], 10)).toBeNull();
  });
});

describe('gapToIndex', () => {
  const IDS = [10, 20, 30, 40];

  it.each([
    ['down one, across the gap under the next row', [10], 2, 1],
    ['to the end', [10], 4, 3],
    ['up to the top', [40], 0, 0],
    ['up one', [40], 3, 3],
    ['several', [20, 30], 4, 2],
  ])('%s', (_name, moving, gap, index) => {
    expect(gapToIndex(IDS, moving, gap)).toBe(index);
  });

  it('the gaps either side of a row both leave it where it is', () => {
    expect(isSamePlace(IDS, [20], gapToIndex(IDS, [20], 1))).toBe(true);
    expect(isSamePlace(IDS, [20], gapToIndex(IDS, [20], 2))).toBe(true);
    expect(isSamePlace(IDS, [20], gapToIndex(IDS, [20], 3))).toBe(false);
  });

  it('several that are scattered are not in place, even at the right index', () => {
    expect(isSamePlace(IDS, [10, 30], 0)).toBe(false);
  });
});
