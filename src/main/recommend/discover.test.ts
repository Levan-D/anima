import { describe, expect, it } from 'vitest';
import { artistProfiles, discoverArtists, discoverDetail, genresOf, inferGenres, type ArtistLinkRow } from './discover';
import { songKey } from './engine';

function link(sourceName: string, targetName: string, score = 0.5): ArtistLinkRow {
  return { sourceKey: sourceName, sourceName, targetKey: targetName, targetName, score };
}

describe('discoverDetail', () => {
  const ids = new Map([
    ['A', 1],
    ['B', 2],
  ]);

  it('holds every owned artist linked to it, strongest first, leaving out the tail and what is gone', () => {
    const { voices } = discoverDetail(
      'X',
      [link('A', 'X', 0.3), link('B', 'X', 0.9), link('Gone', 'X', 1), link('A', 'Y', 1)],
      [],
      new Map(),
      ids,
      new Map([['B', { artHash: 'hash', genres: new Map() }]]),
    );
    expect(voices).toEqual([
      { artistId: 2, name: 'B', artHash: 'hash', score: 0.9 },
      { artistId: 1, name: 'A', artHash: null, score: 0.3 },
    ]);
    expect(discoverDetail('X', [link('A', 'X', 0.01)], [], new Map(), ids, new Map()).voices).toEqual([]);
  });

  it('says which owned tracks lead to each song, most connected song first', () => {
    const lead = (sourceTitle: string, targetTitle: string, score: number) => ({
      sourceArtistKey: 'A',
      sourceTitleKey: sourceTitle,
      sourceArtist: 'A',
      sourceTitle,
      targetTitleKey: targetTitle,
      targetTitle,
      score,
    });
    const { tracks } = discoverDetail(
      'X',
      [],
      [lead('one', 'small', 0.4), lead('one', 'big', 0.3), lead('two', 'big', 0.6), lead('gone', 'big', 1)],
      new Map([
        [songKey('A', 'one'), { trackId: 11, artistId: 1 }],
        [songKey('A', 'two'), { trackId: 12, artistId: 1 }],
      ]),
      ids,
      new Map(),
    );
    expect(tracks).toEqual([
      {
        title: 'big',
        ledBy: [
          { trackId: 12, artistId: 1, artist: 'A', title: 'two' },
          { trackId: 11, artistId: 1, artist: 'A', title: 'one' },
        ],
      },
      { title: 'small', ledBy: [{ trackId: 11, artistId: 1, artist: 'A', title: 'one' }] },
    ]);
  });
});

describe('discoverArtists', () => {
  it('ranks by how many owned artists point at it, and says who', () => {
    const artists = discoverArtists(
      [link('A', 'X', 0.9), link('A', 'Y'), link('B', 'Y', 0.8)],
      [],
      new Set(['A', 'B']),
    );
    expect(artists.map(({ name }) => name)).toEqual(['Y', 'X']);
    expect(artists[0]?.recommendedBy.map(({ name }) => name)).toEqual(['B', 'A']);
    expect(artists[0]?.recommenderCount).toBe(2);
  });

  it('leaves out what is owned, and what only something not owned points at', () => {
    const artists = discoverArtists([link('A', 'B'), link('Gone', 'X')], [], new Set(['A', 'B']));
    expect(artists).toEqual([]);
  });

  it('works out owned from the set it is given, so owning it later drops it with no new data', () => {
    const links = [link('A', 'Van Halen')];
    expect(discoverArtists(links, [], new Set(['A']))).toHaveLength(1);
    expect(discoverArtists(links, [], new Set(['A', 'Van Halen']))).toHaveLength(0);
  });

  it('ignores the tail of an answer', () => {
    expect(discoverArtists([link('A', 'X', 0.01)], [], new Set(['A']))).toEqual([]);
  });

  it('lists the tracks known for it, most connected first', () => {
    const [artist] = discoverArtists(
      [link('A', 'X')],
      [
        { targetArtistKey: 'X', targetTitleKey: 'one', targetTitle: 'One', score: 0.2 },
        { targetArtistKey: 'X', targetTitleKey: 'two', targetTitle: 'Two', score: 0.5 },
        { targetArtistKey: 'X', targetTitleKey: 'one', targetTitle: 'One', score: 0.4 },
        { targetArtistKey: 'Z', targetTitleKey: 'no', targetTitle: 'No', score: 1 },
      ],
      new Set(['A']),
    );
    expect(artist?.tracks).toEqual(['One', 'Two']);
  });

  it('takes art and genres from who recommends it', () => {
    const profiles = artistProfiles(
      [{ artistKey: 'A', genre: 'Rock', tracks: 3 }],
      [
        { artistKey: 'A', artHash: 'big' },
        { artistKey: 'A', artHash: 'small' },
      ],
    );
    const [artist] = discoverArtists([link('A', 'X')], [], new Set(['A']), profiles);
    expect(artist?.recommendedBy).toEqual([{ name: 'A', artHash: 'big' }]);
    expect(artist?.genres).toEqual(['Rock']);
  });
});

describe('inferGenres', () => {
  const genres = (entries: Record<string, number>) => new Map(Object.entries(entries));

  it('weights a genre by how strongly its recommender recommends', () => {
    expect(
      inferGenres([
        { score: 1, genres: genres({ Metal: 1 }) },
        { score: 0.1, genres: genres({ Folk: 1 }) },
        { score: 0.1, genres: genres({ Folk: 1 }) },
      ]),
    ).toEqual(['Metal']);
  });

  it('adds up across recommenders, and counts only a share of an artist who spreads wide', () => {
    expect(
      inferGenres([
        { score: 0.5, genres: genres({ Rock: 0.5, Pop: 0.5 }) },
        { score: 0.5, genres: genres({ Rock: 1 }) },
        { score: 0.5, genres: genres({ Pop: 0.5, Soul: 0.5 }) },
      ]),
    ).toEqual(['Rock', 'Pop']);
  });

  it('keeps at most two, and has none with nothing to go on', () => {
    expect(inferGenres([{ score: 1, genres: genres({ A: 0.34, B: 0.33, C: 0.33 }) }])).toEqual(['A', 'B']);
    expect(inferGenres([{ score: 1, genres: new Map() }])).toEqual([]);
  });
});

describe('genresOf', () => {
  it('orders genres by how many suggestions have them', () => {
    const artist = (genres: string[]) => ({
      key: genres.join(),
      name: genres.join(),
      recommenderCount: 1,
      recommendedBy: [],
      genres,
      tracks: [],
    });
    expect(genresOf([artist(['Pop']), artist(['Rock', 'Pop']), artist(['Rock', 'Jazz']), artist(['Rock'])])).toEqual([
      { name: 'Rock', count: 3 },
      { name: 'Pop', count: 2 },
      { name: 'Jazz', count: 1 },
    ]);
  });
});
