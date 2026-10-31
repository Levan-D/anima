import { beforeEach, describe, expect, it } from 'vitest';
import {
  bindSelection,
  clearSelection,
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
  type Selection,
} from '@/lib/selection';

const ORDER = ['a', 'b', 'c', 'd', 'e'];
const NOTHING: Selection = { keys: new Set(), anchor: null };
const keysOf = ({ keys }: Selection) => [...keys].toSorted();
const PLAIN = { ctrl: false, shift: false };

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

  it('a plain press plays and clears, and leaves the anchor for Shift', () => {
    pressRow('a', { ctrl: true, shift: false });
    expect(pressRow('c', PLAIN)).toBe(false);
    expect(selectedKeys().size).toBe(0);
    expect(pressRow('d', { ctrl: false, shift: true })).toBe(true);
    expect([...selectedKeys()]).toEqual(['c', 'd']);
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
    pressRow('a', { ctrl: true, shift: false });
    pressRow('b', { ctrl: true, shift: false });
    bindSelection('list', ['b', 'c']);
    expect([...selectedKeys()]).toEqual(['b']);
    bindSelection('other', ['b', 'c']);
    expect(selectedKeys().size).toBe(0);
  });

  it('only the list that holds it can release it', () => {
    pressRow('a', { ctrl: true, shift: false });
    releaseSelection('some other list');
    expect(selectedKeys().size).toBe(1);
    releaseSelection('list');
    expect(selectedKeys().size).toBe(0);
  });
});
