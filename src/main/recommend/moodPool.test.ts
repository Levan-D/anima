import { describe, expect, it } from 'vitest';
import {
  checkKeyOf,
  filterCounts,
  fitKey,
  playableTracks,
  resolveExamples,
  tracksByRow,
  type MoodTrack,
} from './moodPool';

function track(id: number, row: number, extra: Partial<MoodTrack> = {}): MoodTrack {
  return {
    id,
    row,
    isMissing: false,
    trackKey: `artist\tsong ${id}`,
    albumKey: 'artist\talbum',
    artistKey: 'artist',
    mains: ['Jazz'],
    year: 1995,
    artHash: null,
    ...extra,
  };
}

const TRACKS = [
  track(1, 0),
  track(2, 1, { albumKey: 'artist\tother', mains: ['Jazz', 'Soul'], year: 2004 }),
  track(3, -1),
  track(4, 2, { artistKey: 'someone', albumKey: null, mains: ['Rock'], year: null }),
  track(5, 3, { isMissing: true }),
];

describe('resolveExamples', () => {
  it('finds the songs each kind of example names, and keeps one with none in its place', () => {
    const { examples, trackIds } = resolveExamples(TRACKS, [
      { kind: 'album', key: 'artist\talbum', isYes: true },
      { kind: 'track', key: 'artist\tsong 4', isYes: false },
      { kind: 'artist', key: 'gone', isYes: true },
      { kind: 'genre', key: 'Soul', isYes: true },
      { kind: 'artist', key: 'someone', isYes: false },
    ]);
    expect(trackIds).toEqual([[1, 3, 5], [4], [], [2], [4]]);
    // A song without a fingerprint has no row to learn from.
    expect(examples.map(({ rows }) => rows)).toEqual([[0, 3], [2], [], [1], [2]]);
    expect(examples.map(({ isSingle, isYes }) => [isSingle, isYes])).toEqual([
      [false, true],
      [true, false],
      [false, true],
      [false, true],
      [false, false],
    ]);
  });
});

describe('fitKey', () => {
  const resolved = (isYes: boolean) =>
    resolveExamples(TRACKS, [
      { kind: 'album', key: 'artist\talbum', isYes },
      { kind: 'genre', key: 'Rock', isYes: false },
    ]);

  it('stays the same for the same songs, and changes with the model, a label or the songs', () => {
    const key = fitKey('model-1', resolved(true));
    expect(fitKey('model-1', resolved(true))).toBe(key);
    expect(fitKey('model-2', resolved(true))).not.toBe(key);
    expect(fitKey('model-1', resolved(false))).not.toBe(key);
    expect(
      fitKey('model-1', resolveExamples(TRACKS.slice(1), [{ kind: 'album', key: 'artist\talbum', isYes: true }])),
    ).not.toBe(key);
  });
});

describe('what a station plays', () => {
  const byRow = tracksByRow(TRACKS, 4);

  it('is what its rows hold on this device, with its filter', () => {
    expect(playableTracks(byRow, [3, 2, 0, 1], { genre: null, decade: null }).map(({ id }) => id)).toEqual([4, 1, 2]);
    expect(playableTracks(byRow, [0, 1, 2], { genre: 'Jazz', decade: 1990 }).map(({ id }) => id)).toEqual([1]);
  });

  it('counts each genre with the decade filter, and each decade with the genre filter', () => {
    expect(filterCounts(byRow, [0, 1, 2, 3], { genre: 'Jazz', decade: 2000 })).toEqual({
      genres: [
        { name: 'Jazz', songs: 1 },
        { name: 'Soul', songs: 1 },
      ],
      decades: [
        { decade: 1990, songs: 1 },
        { decade: 2000, songs: 1 },
      ],
    });
  });

  it('asks about one song an album, or an artist’s songs without one', () => {
    expect(checkKeyOf(byRow[0] ?? null)).toBe('album\tartist\talbum');
    expect(checkKeyOf(byRow[2] ?? null)).toBe('artist\tsomeone');
  });
});
