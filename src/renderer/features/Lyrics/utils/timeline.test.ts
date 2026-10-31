import { describe, expect, it } from 'vitest';
import { formatOffset, lineAt, timelineOf } from './timeline';

describe('timelineOf', () => {
  it('ends a line at the next stamp, and shows no row for an empty one', () => {
    const rows = timelineOf([
      { timeMs: 1_000, text: 'plum' },
      { timeMs: 3_000, text: '' },
      { timeMs: 20_000, text: 'pear' },
    ]);
    expect(rows.map(({ text }) => text)).toEqual(['plum', 'pear']);
    expect(rows[0]?.stopMs).toBe(3_000);
  });

  it('merges lines that come too close, without chaining forever', () => {
    const rows = timelineOf([
      { timeMs: 1_000, text: 'plum' },
      { timeMs: 1_300, text: 'pear' },
      { timeMs: 1_600, text: 'quince' },
      { timeMs: 1_900, text: 'fig' },
    ]);
    expect(rows.map(({ text }) => text)).toEqual(['plum\npear', 'quince\nfig']);
  });

  it('stops a line that runs too long for its words', () => {
    const [row] = timelineOf([
      { timeMs: 0, text: 'plum pear' },
      { timeMs: 60_000, text: 'fig' },
    ]);
    expect(row?.stopMs).toBe(6_400);
  });

  it('stops the last line too', () => {
    const rows = timelineOf([{ timeMs: 0, text: 'plum' }]);
    expect(rows[0]?.stopMs).toBe(5_700);
  });
});

describe('lineAt', () => {
  const rows = timelineOf([
    { timeMs: 10_000, text: 'plum' },
    { timeMs: 12_000, text: 'pear' },
    { timeMs: 13_000, text: '' },
    { timeMs: 40_000, text: 'fig' },
  ]);

  it('holds on the first row, unlit, during a lead-in', () => {
    expect(lineAt(rows, 3_000)).toEqual({ index: 0, isLit: false, changesInMs: 7_000 });
  });

  it('lights the current line', () => {
    expect(lineAt(rows, 11_000)).toEqual({ index: 0, isLit: true, changesInMs: 1_000 });
    expect(lineAt(rows, 12_000)).toEqual({ index: 1, isLit: true, changesInMs: 1_000 });
  });

  it('stays in place, unlit, through a gap', () => {
    expect(lineAt(rows, 20_000)).toEqual({ index: 1, isLit: false, changesInMs: 20_000 });
  });

  it('holds calmly after the last line, with nothing more to wait for', () => {
    expect(lineAt(rows, 90_000)).toEqual({ index: 2, isLit: false, changesInMs: Infinity });
  });
});

describe('formatOffset', () => {
  it('shows the sign', () => {
    expect(formatOffset(1_500)).toBe('+1.5 s');
    expect(formatOffset(-500)).toBe('-0.5 s');
    expect(formatOffset(0)).toBe('0 s');
  });
});
