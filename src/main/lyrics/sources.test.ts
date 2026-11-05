import { describe, expect, it } from 'vitest';
import { lyricsFromText } from './sources';

describe('lyricsFromText', () => {
  it('keeps text with [mm:ss] stamps as timed lyrics', () => {
    const text = '[00:01.00]First\n[00:04.50]Second';
    expect(lyricsFromText(text)).toEqual({ ok: true, value: { status: 'found', syncedLrc: text, plainText: null } });
  });

  it('keeps text without stamps as plain lyrics', () => {
    const text = 'First\nSecond';
    expect(lyricsFromText(text)).toEqual({ ok: true, value: { status: 'found', syncedLrc: null, plainText: text } });
  });

  it('turns away text with no lyrics in it', () => {
    expect(lyricsFromText('  \n ')).toMatchObject({ ok: false, error: { code: 'file_unreadable' } });
  });
});
