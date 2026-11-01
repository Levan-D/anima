import { describe, expect, it } from 'vitest';
import type { DiscoverArtist } from '@shared/domain';
import {
  becauseWords,
  coversOf,
  linkedTrackIds,
  mainGenreOf,
  mainGenrePills,
  matching,
  shownVoices,
  strengthWords,
  subGenrePills,
  toLanes,
  voiceGroups,
  wantedGenres,
} from './suggestions';

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

describe('voices', () => {
  const voice = (name: string, score: number) => ({ artistId: score * 100, name, artHash: null, score });

  it('leaves out the slight ones', () => {
    const voices = [voice('A', 0.2), voice('B', 0.19)];
    expect(shownVoices(voices).map(({ name }) => name)).toEqual(['A']);
  });

  it('groups by strength in order, skipping one with nobody in it', () => {
    const groups = voiceGroups([voice('A', 0.9), voice('B', 0.8), voice('C', 0.3)]);
    expect(groups.map(({ strength, voices }) => [strength, voices.map(({ name }) => name)])).toEqual([
      ['Very strong', ['A', 'B']],
      ['Moderate', ['C']],
    ]);
  });

  it("finds each artist's first track that leads here", () => {
    const lead = (trackId: number, artistId: number) => ({ trackId, artistId, artist: '', title: '' });
    const tracks = [
      { title: 'big', ledBy: [lead(1, 7), lead(2, 8)] },
      { title: 'small', ledBy: [lead(3, 7)] },
    ];
    expect([...linkedTrackIds(tracks)]).toEqual([
      [7, 1],
      [8, 2],
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

describe('main and sub genres', () => {
  const genres = [
    { name: 'Rock', count: 2 },
    { name: 'Rock (Classic)', count: 5 },
    { name: 'Rock (Punk)', count: 1 },
    { name: 'Jazz (Vocal)', count: 3 },
    { name: 'Hip Hop', count: 4 },
  ];

  it('reads the main genre from the name', () => {
    expect(['Rock (Classic)', 'Hip Hop', 'R&B'].map(mainGenreOf)).toEqual(['Rock', 'Hip Hop', 'R&B']);
  });

  it('counts a main genre by artist, keeping one that is on but has nothing left', () => {
    const artists = [artist('A', ['Rock (Classic)', 'Rock (Punk)']), artist('B', ['Rock']), artist('C', ['Hip Hop'])];
    expect(mainGenrePills(artists, ['Gone']).map(({ label, count }) => [label, count])).toEqual([
      ['Rock', 2],
      ['Hip Hop', 1],
      ['Gone', 0],
    ]);
  });

  it('shows the sub genres of what is on, naming the main one when there are two', () => {
    expect(subGenrePills(genres, ['Rock']).map(({ label }) => label)).toEqual(['Classic', 'Punk']);
    expect(subGenrePills(genres, ['Rock', 'Jazz']).map(({ label }) => label)).toEqual([
      'Rock (Classic)',
      'Rock (Punk)',
      'Jazz (Vocal)',
    ]);
    expect(subGenrePills(genres, ['Hip Hop'])).toEqual([]);
  });

  it('wants all of a main genre until one of its sub genres is picked', () => {
    expect(wantedGenres(genres, ['Rock'], [])).toEqual(['Rock', 'Rock (Classic)', 'Rock (Punk)']);
    expect(wantedGenres(genres, ['Rock'], ['Rock (Punk)'])).toEqual(['Rock (Punk)']);
    expect(wantedGenres(genres, ['Rock', 'Hip Hop'], ['Rock (Punk)'])).toEqual(['Rock (Punk)', 'Hip Hop']);
    expect(wantedGenres(genres, [], [])).toEqual([]);
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
