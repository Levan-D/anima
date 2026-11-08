import { describe, expect, it } from 'vitest';
import { countWords, parseLrc, plainFrom, sungShare } from './lrc';

const lines = (text: string) => parseLrc(text).synced;

describe('parseLrc', () => {
  it.each([
    ['[01:02.34]plum', 62_340],
    ['[01:02.345]plum', 62_345],
    ['[01:02.3]plum', 62_300],
    ['[1:02]plum', 62_000],
    ['[01:02:34]plum', 62_340],
    ['[01:75.50]plum', 135_500],
  ])('reads %s', (text, timeMs) => {
    expect(lines(text)).toEqual([{ timeMs, text: 'plum' }]);
  });

  it('gives a line with several stamps a row for each', () => {
    expect(lines('[00:10.00][00:20.00] [00:30.00]plum')).toEqual([
      { timeMs: 10_000, text: 'plum' },
      { timeMs: 20_000, text: 'plum' },
      { timeMs: 30_000, text: 'plum' },
    ]);
  });

  it('sorts by time and keeps the order of equal stamps', () => {
    const text = '[00:20.00]third\n[00:10.00]first\n[00:10.00]second\n[00:30.00]fourth';
    expect(lines(text)).toEqual([
      { timeMs: 10_000, text: 'first\nsecond' },
      { timeMs: 20_000, text: 'third' },
      { timeMs: 30_000, text: 'fourth' },
    ]);
  });

  it('drops known tags and leaves bracketed words alone', () => {
    const text = [
      '[ar:Plum]',
      '[TI: Pear]',
      '[length:03:00]',
      '[id:abc]',
      '[00:01.00][Chorus: both] plum',
      '[Bridge: quince]',
    ].join('\n');
    expect(lines(text)).toEqual([{ timeMs: 1_000, text: '[Chorus: both] plum\n[Bridge: quince]' }]);
  });

  it('strips word tags', () => {
    expect(lines('[00:01.00]<00:01.00>plum <00:01.50>pear')).toEqual([{ timeMs: 1_000, text: 'plum pear' }]);
  });

  it('keeps timed empty and symbol-only lines as line ends', () => {
    expect(lines('[00:01.00]plum\n[00:05.00]\n[00:06.00]♪ ♪\n[00:09.00]pear')).toEqual([
      { timeMs: 1_000, text: 'plum' },
      { timeMs: 5_000, text: '' },
      { timeMs: 6_000, text: '' },
      { timeMs: 9_000, text: 'pear' },
    ]);
  });

  it('has no sync when no timed line has words', () => {
    expect(lines('[00:01.00]\n[00:02.00]♪')).toBeNull();
  });

  it('splits on any line end and cleans what shows', () => {
    expect(lines('[00:01.00]plum pear\r[00:02.00]it\u0092s\r\n[00:03.00]qu\u0081ince  \n')).toEqual([
      { timeMs: 1_000, text: 'plum pear' },
      { timeMs: 2_000, text: 'it’s' },
      { timeMs: 3_000, text: 'quince' },
    ]);
  });

  it('honors [offset:], a positive one making lines sooner', () => {
    expect(lines('[offset:+500]\n[00:01.00]plum')).toEqual([{ timeMs: 500, text: 'plum' }]);
    expect(lines('[offset: -250]\n[00:01.00]plum')).toEqual([{ timeMs: 1_250, text: 'plum' }]);
    expect(lines('[offset:+2000]\n[00:01.00]plum')).toEqual([{ timeMs: 0, text: 'plum' }]);
  });

  it("doesn't believe a huge [offset:]", () => {
    expect(lines('[offset:-47000]\n[00:01.00]plum')).toEqual([{ timeMs: 1_000, text: 'plum' }]);
  });

  it('adds a line with no stamp to the one above, and drops one with nothing above', () => {
    expect(lines('stray\n[00:01.00]plum\npear\n[00:02.00]quince')).toEqual([
      { timeMs: 1_000, text: 'plum\npear' },
      { timeMs: 2_000, text: 'quince' },
    ]);
  });

  it('falls back to plain text with no stamps', () => {
    expect(parseLrc('plum\n\n\npear\n[Chorus]')).toEqual({ synced: null, plain: 'plum\n\npear\n[Chorus]' });
  });
});

describe('plainFrom', () => {
  it('takes out stamps and tags, and keeps labels', () => {
    expect(plainFrom('[ti:Plum]\n[00:01.00]plum\n[00:02.00]<00:02.00>pear\n\n[Outro: all]')).toBe(
      'plum\npear\n\n[Outro: all]',
    );
  });

  it('is null for nothing', () => {
    expect(plainFrom(' \n[ar:Plum]\n')).toBeNull();
  });
});

describe('countWords', () => {
  it('counts words in any script, without labels', () => {
    expect(countWords('[Chorus] plum, pear-tree слива 3')).toBe(5);
  });
});

describe('sungShare', () => {
  const line = (timeMs: number, text = 'la') => ({ timeMs, text });

  it('counts each line with words until the next one starts', () => {
    expect(sungShare([line(0), line(5_000), line(10_000, ''), line(20_000)], 40_000)).toBe(
      (5_000 + 5_000 + 4_000) / 40_000,
    );
  });

  it('stops a line after 10 s, since a longer gap has nobody singing', () => {
    expect(sungShare([line(0), line(60_000, '')], 60_000)).toBe(10_000 / 60_000);
  });

  it('is nothing without lines or length, and never more than all of it', () => {
    expect(sungShare([], 60_000)).toBe(0);
    expect(sungShare([line(0)], 0)).toBe(0);
    expect(sungShare([line(0), line(5_000)], 6_000)).toBe(1);
  });
});
