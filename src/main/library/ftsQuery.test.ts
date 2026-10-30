import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '@main/db/migrations';
import { ftsQueries } from '@main/library/ftsQuery';

const db = new Database(':memory:');
for (const { sql } of MIGRATIONS) db.exec(sql);
db.prepare('INSERT INTO tracks_fts (rowid, title, artist, album) VALUES (?, ?, ?, ?)').run(
  1,
  'Jóga',
  'Björk',
  'Homogenic',
);
db.prepare('INSERT INTO tracks_fts (rowid, title, artist, album) VALUES (?, ?, ?, ?)').run(
  2,
  'Back in Black',
  'AC/DC',
  'Back in Black',
);
db.prepare('INSERT INTO tracks_fts (rowid, title, artist, album) VALUES (?, ?, ?, ?)').run(
  3,
  'Human',
  'Nightwish',
  'Human II Nature',
);
const match = db.prepare<[string], { rowid: number }>('SELECT rowid FROM tracks_fts WHERE tracks_fts MATCH ?');

afterAll(() => db.close());

function matches(query: string | undefined): number[] {
  if (query === undefined) return [];
  return match.all(query).map(({ rowid }) => rowid);
}

describe('ftsQueries', () => {
  it('has nothing to look for in empty or punctuation-only input', () => {
    for (const input of [
      '',
      '   ',
      '!!!',
      '---',
      '"',
      '""',
      '***',
      '( )',
      '. , ;',
      '\t\n',
      '\u0000',
      '⚡',
      '""" ***',
    ]) {
      expect(ftsQueries(input)).toBeNull();
    }
  });

  it('makes every word a quoted prefix, joined with AND', () => {
    expect(ftsQueries('night wish')?.tracks).toBe('"night"* AND "wish"*');
  });

  it('finds Björk from bjork', () => {
    expect(matches(ftsQueries('bjork')?.tracks)).toEqual([1]);
    expect(matches(ftsQueries('BJÖRK')?.tracks)).toEqual([1]);
    expect(matches(ftsQueries('jog')?.tracks)).toEqual([1]);
  });

  it('matches prefixes', () => {
    expect(matches(ftsQueries('nightw')?.tracks)).toEqual([3]);
    expect(matches(ftsQueries('n')?.tracks)).toEqual([3]);
  });

  it('needs every word, but across any column', () => {
    expect(matches(ftsQueries('nightwish nature')?.tracks)).toEqual([3]);
    expect(matches(ftsQueries('nightwish bjork')?.tracks)).toEqual([]);
  });

  it('reads punctuation inside a word the way the index did', () => {
    expect(matches(ftsQueries('AC/DC')?.tracks)).toEqual([2]);
  });

  it('limits artists to the artist column', () => {
    expect(matches(ftsQueries('nightwish')?.artists)).toEqual([3]);
    expect(matches(ftsQueries('human')?.artists)).toEqual([]);
    expect(matches(ftsQueries('black')?.artists)).toEqual([]);
  });

  it('needs an album word in the album column, and lets the others name the artist', () => {
    expect(matches(ftsQueries('human')?.albums)).toEqual([3]);
    expect(matches(ftsQueries('nightwish human')?.albums)).toEqual([3]);
    expect(matches(ftsQueries('nightwish')?.albums)).toEqual([]);
  });

  it('never lets anything typed become FTS syntax', () => {
    const inputs = [
      'AND',
      'OR',
      'NOT',
      'NEAR',
      'a AND',
      'OR b',
      'NOT c',
      'NEAR(a b)',
      'NEAR(a b, 2)',
      'title:foo',
      '{title}:foo',
      'title : foo',
      '^foo',
      'foo*',
      '*foo',
      '(foo',
      'foo)',
      '"foo',
      'foo"',
      'fo"o',
      '"foo bar"',
      "it's",
      'a + b',
      'a - b',
      '-a',
      '+a',
      'a:',
      ':a',
      '[a]',
      '{a}',
      'a\u0000b',
      'a\u0001b',
      '\\',
      'a\\"',
      '%',
      '_',
      'é',
      '日本語',
      'naïve café',
    ];
    for (const input of inputs) {
      const queries = ftsQueries(input);
      if (queries === null) continue;
      expect(() => match.all(queries.tracks)).not.toThrow();
      expect(() => match.all(queries.artists)).not.toThrow();
      expect(() => match.all(queries.albums)).not.toThrow();
    }
  });

  it('survives anything thrown at it', () => {
    const alphabet = ' "*^():{}[]-+.,;\'\\/!?%&ab1é日\t\n\u0000\u0001';
    let seed = 12345;
    const random = (limit: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % limit;
    };
    for (let round = 0; round < 2000; round++) {
      const input = Array.from({ length: random(12) }, () => alphabet[random(alphabet.length)]).join('');
      const queries = ftsQueries(input);
      if (queries === null) continue;
      expect(() => match.all(queries.tracks), input).not.toThrow();
      expect(() => match.all(queries.artists), input).not.toThrow();
      expect(() => match.all(queries.albums), input).not.toThrow();
    }
  });
});
