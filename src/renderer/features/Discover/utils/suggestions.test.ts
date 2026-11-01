import { describe, expect, it } from 'vitest';
import type { DiscoverArtist } from '@shared/domain';
import { becauseWords, coversOf, genrePills, matching, strengthWords, toLanes } from './suggestions';

function artist(name: string, genres: string[] = []): DiscoverArtist {
  return { key: name, name, recommenderCount: 1, recommendedBy: [], genres, tracks: [] };
}

describe('strengthWords', () => {
  it('turns a score into a word at each step', () => {
    expect([1, 0.7, 0.5, 0.2, 0.05].map(strengthWords)).toEqual([
      'Very strong',
      'Very strong',
      'Strong',
      'Moderate',
      'Slight',
    ]);
  });
});

describe('matching', () => {
  it('keeps any that has any of the genres, in order', () => {
    const artists = [artist('A', ['Rock']), artist('B', ['Pop']), artist('C', ['Jazz', 'Rock'])];
    expect(matching(artists, ['Rock', 'Pop']).map(({ name }) => name)).toEqual(['A', 'B', 'C']);
    expect(matching(artists, ['Jazz']).map(({ name }) => name)).toEqual(['C']);
    expect(matching(artists, [])).toBe(artists);
  });

  it('searches the name and who recommends it, ignoring case and accents', () => {
    const artists = [
      artist('Björk'),
      { ...artist('Muse'), recommendedBy: [{ id: 1, name: 'Woodkid', artHash: null, strength: 1 }] },
    ];
    expect(matching(artists, [], 'BJORK').map(({ name }) => name)).toEqual(['Björk']);
    expect(matching(artists, [], 'woodk').map(({ name }) => name)).toEqual(['Muse']);
  });
});

describe('genrePills', () => {
  it('keeps a pill that is on but has nothing left', () => {
    expect(genrePills([{ name: 'Rock', count: 2 }], ['Gone']).map(({ label, count }) => [label, count])).toEqual([
      ['Rock', 2],
      ['Gone', 0],
    ]);
  });
});

describe('becauseWords', () => {
  it('names the closest two', () => {
    const recommendedBy = ['AC/DC', 'Aerosmith', 'Kiss'].map((name) => ({ name, artHash: null }));
    expect(becauseWords({ ...artist('X'), recommendedBy, recommenderCount: 8 })).toBe(
      'Because you like AC/DC, Aerosmith',
    );
  });
});

describe('coversOf', () => {
  it('prefers those with a sleeve, at most three', () => {
    const cover = (name: string, artHash: string | null) => ({ name, artHash });
    expect(coversOf([cover('A', null), cover('B', 'b')])).toEqual([cover('B', 'b')]);
    expect(coversOf([cover('A', null), cover('B', null)])).toEqual([cover('A', null)]);
    expect(coversOf(['a', 'b', 'c', 'd'].map((hash) => cover(hash, hash)))).toHaveLength(3);
  });
});

describe('toLanes', () => {
  it('splits into rows, the last one short', () => {
    expect(toLanes([artist('A'), artist('B'), artist('C')], 2).map(({ suggestions }) => suggestions.length)).toEqual([
      2, 1,
    ]);
  });
});
