import { describe, expect, it } from 'vitest';
import { nextCell } from '@/lib/listKeys';

// 0: a heading, 1-3: rows of three cards (the last has two), 4: a heading, 5-7: plain rows.
const COLUMNS = [0, 3, 3, 2, 0, 1, 1, 1];
const grid = {
  count: COLUMNS.length,
  columnsAt: (index: number) => COLUMNS[index] ?? 0,
  pageSize: 3,
};

function press(key: string, index: number, column = 0) {
  return nextCell(key, { index, column }, grid);
}

describe('nextCell', () => {
  it('moves down and up, keeping the column', () => {
    expect(press('ArrowDown', 1, 2)).toEqual({ index: 2, column: 2 });
    expect(press('ArrowUp', 2, 1)).toEqual({ index: 1, column: 1 });
  });

  it('steps over headings', () => {
    expect(press('ArrowDown', 3, 1)).toEqual({ index: 5, column: 0 });
    expect(press('ArrowUp', 5)).toEqual({ index: 3, column: 0 });
  });

  it('lands on the last card of a shorter row', () => {
    expect(press('ArrowDown', 2, 2)).toEqual({ index: 3, column: 1 });
  });

  it('stops at the ends, leaving the key alone', () => {
    expect(press('ArrowDown', 7)).toBeNull();
    expect(press('ArrowUp', 1)).toBeNull();
  });

  it('moves across a row of cards, and on to the next row at its end', () => {
    expect(press('ArrowRight', 1, 0)).toEqual({ index: 1, column: 1 });
    expect(press('ArrowRight', 1, 2)).toEqual({ index: 2, column: 0 });
    expect(press('ArrowLeft', 2, 0)).toEqual({ index: 1, column: 2 });
  });

  it('does nothing sideways in a plain list', () => {
    expect(press('ArrowRight', 6)).toBeNull();
    expect(press('ArrowLeft', 6)).toBeNull();
  });

  it('jumps a page, and stops at the ends', () => {
    expect(press('PageDown', 1)).toEqual({ index: 5, column: 0 });
    expect(press('PageDown', 6)).toEqual({ index: 7, column: 0 });
    expect(press('PageUp', 6)).toEqual({ index: 3, column: 0 });
    expect(press('PageUp', 2)).toEqual({ index: 1, column: 0 });
  });

  it('goes to the first and last thing that takes focus', () => {
    expect(press('Home', 6)).toEqual({ index: 1, column: 0 });
    expect(press('End', 1)).toEqual({ index: 7, column: 0 });
  });

  it('leaves other keys alone', () => {
    expect(press('Enter', 1)).toBeNull();
    expect(press('a', 1)).toBeNull();
  });
});
