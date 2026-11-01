import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  bindSelection,
  clearSelection,
  isSelectionShowing,
  extendByKey,
  extendToRow,
  keepRows,
  pressRow,
  releaseSelection,
  resetSelection,
  selectAllRows,
  selectedKeys,
  startSelecting,
  toggleRow,
  useSelection,
  type Selection,
} from '@/lib/selection';

const ORDER = ['a', 'b', 'c', 'd', 'e'];
const NOTHING: Selection = { keys: new Set(), anchor: null };
const keysOf = ({ keys }: Selection) => [...keys].toSorted();
const PLAIN = { ctrl: false, shift: false, isMouse: false };
const MOUSE = { ...PLAIN, isMouse: true };
const CTRL = { ...MOUSE, ctrl: true };
const SHIFT = { ...MOUSE, shift: true };

describe('toggleRow', () => {
  it('adds, removes and moves the anchor', () => {
    const one = toggleRow(NOTHING, 'b');
    expect(keysOf(one)).toEqual(['b']);
    const two = toggleRow(one, 'd');
    expect(keysOf(two)).toEqual(['b', 'd']);
    expect(two.anchor).toBe('d');
    expect(keysOf(toggleRow(two, 'b'))).toEqual(['d']);
  });
});

describe('extendToRow', () => {
  it('goes from the anchor in either direction, replacing what was picked', () => {
    const start = toggleRow(toggleRow(NOTHING, 'e'), 'b');
    expect(keysOf(extendToRow(start, ORDER, 'd'))).toEqual(['b', 'c', 'd']);
    const up = toggleRow(NOTHING, 'c');
    expect(keysOf(extendToRow(up, ORDER, 'a'))).toEqual(['a', 'b', 'c']);
  });

  it('keeps the anchor, so a second Shift+click measures from the same row', () => {
    const first = extendToRow(toggleRow(NOTHING, 'b'), ORDER, 'e');
    expect(keysOf(extendToRow(first, ORDER, 'a'))).toEqual(['a', 'b']);
  });

  it('with no anchor, or one that has gone, picks just the row', () => {
    expect(keysOf(extendToRow(NOTHING, ORDER, 'c'))).toEqual(['c']);
    expect(keysOf(extendToRow({ keys: new Set(), anchor: 'gone' }, ORDER, 'c'))).toEqual(['c']);
  });
});

describe('extendByKey', () => {
  it('starts at the row focus was on, grows and shrinks back', () => {
    const one = extendByKey(NOTHING, ORDER, 'b', 'c');
    expect(keysOf(one)).toEqual(['b', 'c']);
    const two = extendByKey(one, ORDER, 'c', 'd');
    expect(keysOf(two)).toEqual(['b', 'c', 'd']);
    expect(keysOf(extendByKey(two, ORDER, 'd', 'c'))).toEqual(['b', 'c']);
  });

  it('starts over when focus has moved out of the selection', () => {
    const picked = extendByKey(NOTHING, ORDER, 'a', 'b');
    expect(keysOf(extendByKey(picked, ORDER, 'd', 'e'))).toEqual(['d', 'e']);
  });
});

describe('keepRows', () => {
  it('hands back the same object when nothing went', () => {
    const selection = toggleRow(NOTHING, 'a');
    expect(keepRows(selection, ORDER)).toBe(selection);
  });

  it('drops rows that are gone, and an anchor with them', () => {
    const kept = keepRows({ keys: new Set(['a', 'x']), anchor: 'x' }, ORDER);
    expect(keysOf(kept)).toEqual(['a']);
    expect(kept.anchor).toBeNull();
  });
});

describe('the store', () => {
  beforeEach(() => {
    resetSelection();
    bindSelection('list', ORDER);
  });

  it('a tap or Enter clears, is free to play, and leaves the anchor for Shift', () => {
    pressRow('a', CTRL);
    expect(pressRow('c', PLAIN)).toBe(false);
    expect(selectedKeys().size).toBe(0);
    expect(pressRow('d', SHIFT)).toBe(true);
    expect([...selectedKeys()]).toEqual(['c', 'd']);
  });

  it('a mouse click selects that row alone, and is still free to play', () => {
    expect(pressRow('a', MOUSE)).toBe(false);
    expect([...selectedKeys()]).toEqual(['a']);
    expect(pressRow('c', MOUSE)).toBe(false);
    expect([...selectedKeys()]).toEqual(['c']);
    pressRow('d', SHIFT);
    expect(pressRow('a', MOUSE)).toBe(false);
    expect([...selectedKeys()]).toEqual(['a']);
  });

  it('a click sets where Shift measures from, and Ctrl adds to it', () => {
    pressRow('b', MOUSE);
    pressRow('d', SHIFT);
    expect([...selectedKeys()]).toEqual(['b', 'c', 'd']);
    pressRow('a', MOUSE);
    pressRow('c', CTRL);
    expect([...selectedKeys()]).toEqual(['a', 'c']);
  });

  it('only shows a bar for two or more, or in selection mode', () => {
    const showing = () => isSelectionShowing(renderHook(() => useSelection((state) => state)).result.current);
    pressRow('a', MOUSE);
    expect(showing()).toBe(false);
    pressRow('b', CTRL);
    expect(showing()).toBe(true);
    pressRow('b', CTRL);
    expect(showing()).toBe(false);
    startSelecting('a');
    expect(showing()).toBe(true);
  });

  it('clears a single row without counting as having cleared anything, so going back still goes back', () => {
    pressRow('a', MOUSE);
    expect(clearSelection()).toBe(false);
    expect(selectedKeys().size).toBe(0);
  });

  it('a plain press in selection mode toggles', () => {
    startSelecting('a');
    expect(pressRow('b', PLAIN)).toBe(true);
    expect([...selectedKeys()]).toEqual(['a', 'b']);
    expect(pressRow('a', PLAIN)).toBe(true);
    expect([...selectedKeys()]).toEqual(['b']);
  });

  it('selects all of thousands without looking at anything but ids', () => {
    const many = Array.from({ length: 5_700 }, (_, index) => `track-${index}`);
    bindSelection('tracks', many);
    selectAllRows();
    expect(selectedKeys().size).toBe(5_700);
  });

  it('says whether there was anything to clear, including an empty selection mode', () => {
    expect(clearSelection()).toBe(false);
    startSelecting('a');
    pressRow('a', PLAIN);
    expect(selectedKeys().size).toBe(0);
    expect(clearSelection()).toBe(true);
    expect(clearSelection()).toBe(false);
  });

  it('a different list starts empty, and the same list keeps what is still there', () => {
    pressRow('a', CTRL);
    pressRow('b', CTRL);
    bindSelection('list', ['b', 'c']);
    expect([...selectedKeys()]).toEqual(['b']);
    bindSelection('other', ['b', 'c']);
    expect(selectedKeys().size).toBe(0);
  });

  it('a list with another over it gets its selection back when that one goes, with what it was told meanwhile', () => {
    pressRow('a', CTRL);
    pressRow('b', CTRL);
    bindSelection('sheet', ['q']);
    expect(selectedKeys().size).toBe(0);

    bindSelection('list', ['b', 'c']);
    expect(selectedKeys().size).toBe(0);

    releaseSelection('sheet');
    expect([...selectedKeys()]).toEqual(['b']);
  });

  it('only the list that holds it can release it', () => {
    pressRow('a', CTRL);
    releaseSelection('some other list');
    expect(selectedKeys().size).toBe(1);
    releaseSelection('list');
    expect(selectedKeys().size).toBe(0);
  });
});
