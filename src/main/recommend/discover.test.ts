import { describe, expect, it } from 'vitest';
import { discoverArtists, type ArtistLinkRow } from './discover';

function link(sourceName: string, targetName: string, score = 0.5): ArtistLinkRow {
  return { sourceKey: sourceName, sourceName, targetKey: targetName, targetName, score };
}

describe('discoverArtists', () => {
  it('ranks by how many owned artists point at it, and says who', () => {
    const artists = discoverArtists(
      [link('A', 'X', 0.9), link('A', 'Y'), link('B', 'Y', 0.8)],
      [],
      new Set(['A', 'B']),
    );
    expect(artists.map(({ name }) => name)).toEqual(['Y', 'X']);
    expect(artists[0]?.recommendedBy).toEqual(['B', 'A']);
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
});
