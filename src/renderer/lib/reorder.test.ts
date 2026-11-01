import { describe, expect, it } from 'vitest';
import { edgePull, gapAt, gapToIndex, isSamePlace, placesOf, restingPlace, slotAt } from '@/lib/reorder';

describe('placesOf', () => {
  it('counts ranks past the rows that are moving', () => {
    const places = placesOf([10, 20, 30, 40], new Set([20]));
    expect(places.get(10)).toEqual({ index: 0, rank: 0 });
    expect(places.get(30)).toEqual({ index: 2, rank: 1 });
    expect(places.get(40)).toEqual({ index: 3, rank: 2 });
  });
});

describe('slotAt', () => {
  it.each([
    ['above the list', -500, 0],
    ['just under a row top', 20, 0],
    ['past halfway', 30, 1],
    ['far below the list', 5000, 3],
  ])('%s', (_name, offset, slot) => {
    expect(slotAt(offset, 50, 3)).toBe(slot);
  });
});

describe('restingPlace', () => {
  it('leaves rows above the gap alone and moves those below by what is moving', () => {
    expect(restingPlace(1, 2, 3)).toBe(1);
    expect(restingPlace(2, 2, 3)).toBe(5);
  });
});

describe('edgePull', () => {
  it.each([
    ['in the middle', 500, 0],
    ['halfway into the top zone', 150, -0.25],
    ['at the top', 100, -1],
    ['past the top', 0, -1],
    ['halfway into the bottom zone', 850, 0.25],
    ['past the bottom', 2000, 1],
  ])('%s', (_name, y, pull) => {
    expect(edgePull(y, 100, 900, 100)).toBe(pull);
  });
});

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
