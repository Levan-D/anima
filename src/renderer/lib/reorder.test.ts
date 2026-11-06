import { describe, expect, it } from 'vitest';
import { edgePull, isSamePlace, placesOf, restingPlace, slotAt } from '@/lib/reorder';

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

describe('isSamePlace', () => {
  const IDS = [10, 20, 30, 40];

  it('a row moved to where it already is stays put, and one place on is a move', () => {
    expect(isSamePlace(IDS, [20], 1)).toBe(true);
    expect(isSamePlace(IDS, [20], 2)).toBe(false);
  });

  it('several that are scattered are not in place, even at the right index', () => {
    expect(isSamePlace(IDS, [10, 30], 0)).toBe(false);
  });
});
