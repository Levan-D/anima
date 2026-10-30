import { describe, expect, it } from 'vitest';
import { focusableIn, toMusicItems } from '@/components/music/listItems';
import { album, artist, genre, track } from '@/lib/testing';

describe('toMusicItems', () => {
  it('splits albums into rows of however many lanes fit, keeping a short last row', () => {
    const albums = [1, 2, 3, 4, 5].map((id) => album({ id }));
    const items = toMusicItems([{ kind: 'albums', albums, hideArtist: false }], 2);

    expect(items).toHaveLength(3);
    expect(items.map((item) => (item.kind === 'albumLane' ? item.albums.map(({ id }) => id) : []))).toEqual([
      [1, 2],
      [3, 4],
      [5],
    ]);
  });

  it('keys a row of cards by its place, so new albums arriving do not remount everything on screen', () => {
    const first = toMusicItems(
      [{ kind: 'albums', albums: [album({ id: 1 }), album({ id: 2 })], hideArtist: false }],
      2,
    );
    const second = toMusicItems(
      [{ kind: 'albums', albums: [album({ id: 1 }), album({ id: 2 }), album({ id: 3 })], hideArtist: false }],
      2,
    );
    expect(second[0]?.key).toBe(first[0]?.key);
  });

  it('lays out sections in order, with keys that are unique across them', () => {
    const items = toMusicItems(
      [
        { kind: 'label', text: 'Artists' },
        { kind: 'artists', artists: [artist({ id: 1 })] },
        { kind: 'label', text: 'Albums' },
        { kind: 'albumRows', albums: [album({ id: 1 })] },
        { kind: 'label', text: 'Tracks' },
        { kind: 'tracks', tracks: [track({ id: 1 })], numbered: false },
        { kind: 'genres', genres: [genre({ id: 1 })] },
      ],
      2,
    );

    expect(items.map(({ kind }) => kind)).toEqual(['label', 'artist', 'label', 'albumRow', 'label', 'track', 'genre']);
    expect(new Set(items.map(({ key }) => key)).size).toBe(items.length);
  });

  it('empty sections add nothing', () => {
    expect(
      toMusicItems(
        [
          { kind: 'albums', albums: [], hideArtist: false },
          { kind: 'tracks', tracks: [], numbered: false },
        ],
        3,
      ),
    ).toEqual([]);
  });
});

describe('focusableIn', () => {
  it('counts the cards in a row, nothing in a heading, and one in anything else', () => {
    const [heading, lane, row] = toMusicItems(
      [
        { kind: 'label', text: 'Tracks' },
        { kind: 'albums', albums: [album({ id: 1 }), album({ id: 2 })], hideArtist: false },
        { kind: 'tracks', tracks: [track()], numbered: false },
      ],
      3,
    );
    expect(focusableIn(heading!)).toBe(0);
    expect(focusableIn(lane!)).toBe(2);
    expect(focusableIn(row!)).toBe(1);
  });
});
