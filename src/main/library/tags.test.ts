import type { ICommonTagsResult, IFormat, ITag } from 'music-metadata';
import { describe, expect, it } from 'vitest';
import { hasAudioStream, normalizeFormat, normalizeTags, UNKNOWN_ARTIST } from '@main/library/tags';

function common(overrides: Partial<ICommonTagsResult> = {}): ICommonTagsResult {
  return {
    track: { no: null, of: null },
    disk: { no: null, of: null },
    movementIndex: { no: null, of: null },
    ...overrides,
  };
}

function tagged(overrides: Partial<ICommonTagsResult> = {}, native: Record<string, ITag[]> = {}) {
  return { common: common(overrides), native };
}

function format(overrides: Partial<IFormat> = {}): IFormat {
  return { trackInfo: [], tagTypes: [], ...overrides };
}

const PATH = 'Artist/Album/03 Some Song.flac';

describe('normalizeTags', () => {
  it('keeps tags as written', () => {
    const tags = normalizeTags(
      tagged({
        title: 'Song',
        artist: 'AC/DC & Friends, feat. Someone',
        albumartist: 'AC/DC',
        album: 'Album',
        year: 1980,
        track: { no: 3, of: 12 },
        disk: { no: 2, of: 2 },
      }),
      PATH,
    );
    expect(tags).toMatchObject({
      title: 'Song',
      titleIsFileName: false,
      artist: 'AC/DC & Friends, feat. Someone',
      albumArtist: 'AC/DC',
      album: 'Album',
      year: 1980,
      trackNumber: 3,
      discNumber: 2,
    });
  });

  it('falls back to the file name without its extension for a title', () => {
    const tags = normalizeTags(tagged(), PATH);
    expect(tags.title).toBe('03 Some Song');
    expect(tags.titleIsFileName).toBe(true);
  });

  it('counts a blank title as no title', () => {
    expect(normalizeTags(tagged({ title: '   ' }), PATH).titleIsFileName).toBe(true);
  });

  it('keeps a file name with dots whole, up to the last one', () => {
    expect(normalizeTags(tagged(), 'a/Mr. Brightside.v2.mp3').title).toBe('Mr. Brightside.v2');
  });

  it('uses the artist, then the album artist, then Unknown Artist', () => {
    expect(normalizeTags(tagged({ artist: 'A', albumartist: 'B' }), PATH).artist).toBe('A');
    expect(normalizeTags(tagged({ albumartist: 'B' }), PATH).artist).toBe('B');
    expect(normalizeTags(tagged(), PATH).artist).toBe(UNKNOWN_ARTIST);
  });

  it('uses the album artist, then the artist, for the album', () => {
    expect(normalizeTags(tagged({ artist: 'A', albumartist: 'B' }), PATH).albumArtist).toBe('B');
    expect(normalizeTags(tagged({ artist: 'A' }), PATH).albumArtist).toBe('A');
    expect(normalizeTags(tagged(), PATH).albumArtist).toBe(UNKNOWN_ARTIST);
  });

  it('has no album when the tag is missing or blank', () => {
    expect(normalizeTags(tagged(), PATH).album).toBeNull();
    expect(normalizeTags(tagged({ album: ' ' }), PATH).album).toBeNull();
  });

  it('trims what it keeps', () => {
    const tags = normalizeTags(tagged({ title: ' A ', artist: ' B ', album: ' C ' }), PATH);
    expect(tags).toMatchObject({ title: 'A', artist: 'B', album: 'C' });
  });

  describe('year', () => {
    it('comes from the year tag', () => {
      expect(normalizeTags(tagged({ year: 2011 }), PATH).year).toBe(2011);
    });

    it('falls back to the date', () => {
      expect(normalizeTags(tagged({ date: '2005-06-01' }), PATH).year).toBe(2005);
      expect(normalizeTags(tagged({ date: '01/06/1999' }), PATH).year).toBe(1999);
    });

    it('ignores years that make no sense', () => {
      expect(normalizeTags(tagged({ year: 0 }), PATH).year).toBeNull();
      expect(normalizeTags(tagged({ year: 20111 }), PATH).year).toBeNull();
      expect(normalizeTags(tagged({ year: Number.NaN }), PATH).year).toBeNull();
      expect(normalizeTags(tagged({ date: 'unknown' }), PATH).year).toBeNull();
      expect(normalizeTags(tagged({ date: '199' }), PATH).year).toBeNull();
    });

    it('tries the date when the year tag is nonsense', () => {
      expect(normalizeTags(tagged({ year: 0, date: '1987' }), PATH).year).toBe(1987);
    });

    it('believes the date over a year an ID3v1 block slipped in', () => {
      expect(normalizeTags(tagged({ year: 2007, date: '1997' }), PATH).year).toBe(1997);
    });

    it('reads a date with no separators', () => {
      expect(normalizeTags(tagged({ date: '20030405' }), PATH).year).toBe(2003);
    });
  });

  describe('numbers', () => {
    it('ignores zero and missing numbers', () => {
      const tags = normalizeTags(tagged({ track: { no: 0, of: 0 }, disk: { no: null, of: 1 } }), PATH);
      expect(tags.trackNumber).toBeNull();
      expect(tags.discNumber).toBeNull();
    });

    it('refuses numbers no album could have', () => {
      const tags = normalizeTags(tagged({ track: { no: 1e23, of: null }, disk: { no: 20230405, of: null } }), PATH);
      expect(tags.trackNumber).toBeNull();
      expect(tags.discNumber).toBeNull();
    });
  });

  describe('with stale tag blocks in the file', () => {
    // What We Found Love.flac really has: Vorbis says track 11 and no disc, and an old ID3v2 block says otherwise.
    const vorbis: ITag[] = [
      { id: 'TRACKNUMBER', value: '11' },
      { id: 'DATE', value: '1997' },
    ];
    const staleId3: ITag[] = [
      { id: 'TRCK', value: '03/14' },
      { id: 'TPOS', value: '1/1' },
      { id: 'TPE2', value: 'Someone Else' },
    ];
    const mix = {
      track: { no: 3, of: 14 },
      disk: { no: 1, of: 1 },
      albumartist: 'Someone Else',
      year: 2007,
      date: '2007',
    };

    it('takes everything Vorbis has charge of from Vorbis', () => {
      const tags = normalizeTags(tagged(mix, { vorbis, 'ID3v2.3': staleId3, ID3v1: [] }), PATH);
      expect(tags).toMatchObject({ trackNumber: 11, discNumber: null, year: 1997 });
    });

    it('does not borrow what Vorbis leaves out', () => {
      const tags = normalizeTags(tagged({ ...mix, artist: 'Rihanna' }, { vorbis: [], 'ID3v2.3': staleId3 }), PATH);
      expect(tags).toMatchObject({ trackNumber: null, discNumber: null, year: null, albumArtist: 'Rihanna' });
    });

    it('reads Vorbis names whatever their case, either spelling of album artist, and track/total', () => {
      const tags = normalizeTags(
        tagged(mix, {
          vorbis: [
            { id: 'tracknumber', value: '5/12' },
            { id: 'ALBUM ARTIST', value: 'The Real One' },
          ],
        }),
        PATH,
      );
      expect(tags).toMatchObject({ trackNumber: 5, albumArtist: 'The Real One' });
    });

    it('on an MP3, a stale ID3v1 track number loses to ID3v2, and ID3v2 to APE, as every other field does', () => {
      const id3v2 = [{ id: 'TRCK', value: '06' }];
      const track = { no: 3, of: null };
      expect(normalizeTags(tagged({ track }, { 'ID3v2.3': id3v2, ID3v1: [] }), PATH).trackNumber).toBe(6);
      expect(
        normalizeTags(tagged({ track }, { 'ID3v2.3': id3v2, APEv2: [{ id: 'Track', value: '8' }] }), PATH).trackNumber,
      ).toBe(8);
    });

    it('an APE block with only ReplayGain in it takes nothing away', () => {
      const native = {
        'ID3v2.4': [
          { id: 'TRCK', value: '6/12' },
          { id: 'TPOS', value: '2' },
        ],
        APEv2: [{ id: 'REPLAYGAIN_TRACK_GAIN', value: '-6 dB' }],
      };
      expect(normalizeTags(tagged({}, native), PATH)).toMatchObject({ trackNumber: 6, discNumber: 2 });
    });

    it('falls back to what common has when no block it knows has a number', () => {
      expect(normalizeTags(tagged({ track: { no: 4, of: null } }, { iTunes: [] }), PATH).trackNumber).toBe(4);
    });
  });

  describe('genres', () => {
    it('splits on semicolons, and trims', () => {
      expect(normalizeTags(tagged({ genre: ['Rock; Pop ', ' Jazz'] }), PATH).genres).toEqual(['Rock', 'Pop', 'Jazz']);
    });

    it('removes repeats whatever their case, keeping the first spelling', () => {
      expect(normalizeTags(tagged({ genre: ['Hip Hop', 'HIP HOP', 'hip hop'] }), PATH).genres).toEqual(['Hip Hop']);
    });

    it('does not split on anything else', () => {
      expect(normalizeTags(tagged({ genre: ['Rock/Pop', 'Drum & Bass, Jungle'] }), PATH).genres).toEqual([
        'Rock/Pop',
        'Drum & Bass, Jungle',
      ]);
    });

    it('drops empty values', () => {
      expect(normalizeTags(tagged({ genre: ['', ' ; ', ';Rock;'] }), PATH).genres).toEqual(['Rock']);
    });

    it('is empty with no tag', () => {
      expect(normalizeTags(tagged(), PATH).genres).toEqual([]);
    });

    it('takes what the ID3v2 frame really says over what music-metadata made of it', () => {
      const tags = normalizeTags(tagged({ genre: ['Pop '] }), PATH, ['Pop (indie)']);
      expect(tags.genres).toEqual(['Pop (indie)']);
    });

    it('uses common when there is no frame to go by', () => {
      expect(normalizeTags(tagged({ genre: ['Rock'] }), PATH, null).genres).toEqual(['Rock']);
    });
  });
});

describe('normalizeFormat', () => {
  it('takes what the format says', () => {
    expect(
      normalizeFormat(
        format({
          codec: 'FLAC',
          lossless: true,
          sampleRate: 96000,
          bitsPerSample: 24,
          numberOfChannels: 2,
          duration: 208.65333,
        }),
        PATH,
      ),
    ).toEqual({ codec: 'FLAC', isLossless: true, sampleRate: 96000, bitDepth: 24, channels: 2, durationMs: 208653 });
  });

  it('calls every MPEG layer 3 flavor MP3', () => {
    for (const codec of ['MPEG 1 Layer 3', 'MPEG 2 Layer 3', 'MPEG 2.5 Layer 3']) {
      expect(normalizeFormat(format({ codec }), 'a.mp3').codec).toBe('MP3');
    }
  });

  it('falls back to the container, then the extension, for a codec', () => {
    expect(normalizeFormat(format({ container: 'Ogg' }), 'a.ogg').codec).toBe('Ogg');
    expect(normalizeFormat(format(), 'a/b.opus').codec).toBe('OPUS');
  });

  it('uses null and zero for what it does not know', () => {
    expect(normalizeFormat(format({ codec: 'X' }), 'a.wv')).toEqual({
      codec: 'X',
      isLossless: false,
      sampleRate: null,
      bitDepth: null,
      channels: null,
      durationMs: 0,
    });
  });

  it('calls a length that came out as nothing a track could be zero', () => {
    for (const duration of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -5, 1e300]) {
      expect(normalizeFormat(format({ duration }), PATH).durationMs).toBe(0);
    }
  });

  it('refuses format numbers that are not numbers', () => {
    const odd = normalizeFormat(format({ sampleRate: Number.POSITIVE_INFINITY, bitsPerSample: 1e23 }), PATH);
    expect(odd).toMatchObject({ sampleRate: null, bitDepth: null });
  });
});

describe('hasAudioStream', () => {
  it('needs a codec or sample rate, and no denial', () => {
    expect(hasAudioStream(format({ codec: 'FLAC', hasAudio: true }))).toBe(true);
    expect(hasAudioStream(format({ sampleRate: 44100 }))).toBe(true);
    expect(hasAudioStream(format({ hasAudio: true }))).toBe(false);
    expect(hasAudioStream(format({ codec: 'x', hasAudio: false }))).toBe(false);
    expect(hasAudioStream(format())).toBe(false);
  });
});
