import { describe, expect, it } from 'vitest';
import { draggedWith, focusableIn, toMusicItems } from '@/components/music/listItems';
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

describe('a queue', () => {
  const song = track({ id: 9 });

  it('makes a row for each place, even for the same track twice, knowing which place it is', () => {
    const items = toMusicItems(
      [
        {
          kind: 'queue',
          items: [
            { queueId: 11, track: song },
            { queueId: 12, track: song },
          ],
        },
      ],
      3,
    );

    expect(items.map((item) => (item.kind === 'track' ? [item.key, item.queueIndex] : null))).toEqual([
      ['queue-11', 0],
      ['queue-12', 1],
    ]);
  });

  it('an ordinary list of tracks has no place in the queue', () => {
    const [item] = toMusicItems([{ kind: 'tracks', tracks: [song], numbered: false }], 3);
    expect(item).toMatchObject({ kind: 'track', queueIndex: null });
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

describe('draggedWith', () => {
  const queue = toMusicItems(
    [{ kind: 'queue', items: [1, 2, 3, 4].map((queueId) => ({ queueId, track: track({ id: queueId }) })) }],
    1,
  );

  it('takes the selection in list order when the row is in it, and only the row when it is not', () => {
    const selected = new Set(['queue-3', 'queue-1']);
    expect(draggedWith(queue, selected, 3)).toEqual([1, 3]);
    expect(draggedWith(queue, selected, 2)).toEqual([2]);
  });
});
