import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeText } from '@main/system/decodeText';
import { parseCueSheet, splitOf, splitPlan, type CueSheet } from '@main/library/cueSheet';
import type { FileTags } from '@main/library/tags';

const REAL_SHEETS = [
  'D:\\Music\\Classical Works\\Frederic Chopin\\Piano Works\\[Chopin Frederic] Piano Works.cue',
  'D:\\Music\\Talking Heads\\Stop Making Sense\\Talking Heads – Stop Making Sense.with_gaps.cue',
];

const ALBUM = `
REM GENRE Rock
PERFORMER "The Band"
TITLE "The Album"
FILE "album.flac" WAVE
  TRACK 01 AUDIO
    TITLE "One"
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    TITLE "Two"
    PERFORMER "A Guest"
    INDEX 00 03:00:00
    INDEX 01 03:02:37
  TRACK 03 AUDIO
    INDEX 01 05:00:74
`;

function parsed(text: string): CueSheet {
  const result = parseCueSheet(text);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe('parseCueSheet', () => {
  it('runs each track from its INDEX 01 to the next one, so a pregap stays with the track before', () => {
    const { files, title, performer } = parsed(ALBUM);
    expect({ title, performer }).toEqual({ title: 'The Album', performer: 'The Band' });
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe('album.flac');
    expect(files[0]?.tracks).toEqual([
      { number: 1, title: 'One', performer: null, startMs: 0, endMs: 182_493 },
      { number: 2, title: 'Two', performer: 'A Guest', startMs: 182_493, endMs: 300_987 },
      { number: 3, title: null, performer: null, startMs: 300_987, endMs: null },
    ]);
  });

  it('reads CRLF, odd case and an unquoted name, and a TITLE after the INDEX', () => {
    const { files } = parsed('file album.mp3 MP3\r\n track 1 audio\r\n index 01 00:01:00\r\n title Late\r\n');
    expect(files[0]?.name).toBe('album.mp3');
    expect(files[0]?.tracks[0]).toMatchObject({ startMs: 1000, title: 'Late' });
  });

  it.each([
    ['no file', 'TRACK 01 AUDIO\nINDEX 01 00:00:00'],
    ['no tracks', 'FILE "a.flac" WAVE'],
    ['nothing at all', ''],
    ['a track with no INDEX 01', 'FILE "a.flac" WAVE\nTRACK 01 AUDIO\nINDEX 00 00:00:00'],
    ['frames past 74', 'FILE "a.flac" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:75'],
    ['seconds past 59', 'FILE "a.flac" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:60:00'],
    ['a time that makes no sense', 'FILE "a.flac" WAVE\nTRACK 01 AUDIO\nINDEX 01 soon'],
    ['tracks out of order', 'FILE "a.flac" WAVE\nTRACK 01 AUDIO\nINDEX 01 01:00:00\nTRACK 02 AUDIO\nINDEX 01 00:30:00'],
    [
      'the same number twice',
      'FILE "a.flac" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00\nTRACK 01 AUDIO\nINDEX 01 01:00:00',
    ],
  ])('refuses %s', (_, text) => {
    expect(parseCueSheet(text).ok).toBe(false);
  });
});

describe('splitOf', () => {
  it('ignores a sheet whose files are one track each at 0', () => {
    const sheet = parsed(
      'FILE "a.wav" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00\nFILE "b.wav" WAVE\nTRACK 02 AUDIO\nINDEX 01 00:00:00',
    );
    expect(splitOf(sheet)).toEqual({ ok: true, value: null });
  });

  it('refuses several files cut into tracks', () => {
    const sheet = parsed(
      'FILE "a.wav" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00\nTRACK 02 AUDIO\nINDEX 01 01:00:00\nFILE "b.wav" WAVE\nTRACK 03 AUDIO\nINDEX 01 00:00:00',
    );
    expect(splitOf(sheet).ok).toBe(false);
  });
});

describe('splitPlan', () => {
  const tags: FileTags = {
    title: 'album',
    titleIsFileName: true,
    artist: 'Tag Artist',
    albumArtist: 'Tag Album Artist',
    album: 'Tag Album',
    year: 1999,
    discNumber: 2,
    trackNumber: null,
    genres: ['Rock'],
  };

  it('takes what the sheet leaves out from the tags', () => {
    const plan = splitPlan(
      {
        title: null,
        performer: null,
        fileName: 'a',
        tracks: [{ number: 7, title: null, performer: null, startMs: 0, endMs: null }],
      },
      tags,
    );
    expect(plan).toEqual([
      {
        cueIndex: 1,
        startMs: 0,
        endMs: null,
        tags: { ...tags, title: 'Track 07', titleIsFileName: false, trackNumber: 7 },
      },
    ]);
  });
});

describe.skipIf(!REAL_SHEETS.every(existsSync))('the real sheets', () => {
  it.each(REAL_SHEETS)('%s says its files are the tracks already, so it changes nothing', (path) => {
    const sheet = parsed(decodeText(readFileSync(path)));
    expect(sheet.files.length).toBeGreaterThan(1);
    expect(splitOf(sheet)).toEqual({ ok: true, value: null });
  });
});
