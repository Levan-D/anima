import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Connection } from '@main/db/connection';
import { createLibraryWrites, createQueries, type LibraryQueries, type LibraryWrites } from '@main/library/queries';
import { createScanWriter, type ReadFile } from '@main/library/scanWriter';
import { closeTestDatabase, openTestDatabase, tempDir } from '@main/library/testFixtures';

let db: Connection;
let queries: LibraryQueries;
let writes: LibraryWrites;
let writer: ReturnType<typeof createScanWriter>;
let nextPath = 1;

const NOTHING_FOUND = { artists: [], albums: [], tracks: [], more: { artists: false, albums: false, tracks: false } };

type Song = {
  title: string;
  artist?: string;
  albumArtist?: string;
  album?: string | null;
  year?: number | null;
  disc?: number | null;
  track?: number | null;
  genres?: string[];
  path?: string;
  art?: string | null;
  durationMs?: number;
};

function song({
  title,
  artist = 'Someone',
  albumArtist,
  album = null,
  year = null,
  disc = null,
  track = null,
  genres = [],
  path,
  art = null,
  durationMs = 1000,
}: Song): ReadFile {
  const relPath = path ?? `file ${nextPath++}.flac`;
  return {
    id: null,
    found: { relPath, sizeBytes: 1, mtimeMs: 1 },
    audioHash: `hash-${relPath}`,
    tags: {
      title,
      titleIsFileName: false,
      artist,
      albumArtist: albumArtist ?? artist,
      album,
      year,
      discNumber: disc,
      trackNumber: track,
      genres,
    },
    format: { codec: 'FLAC', isLossless: true, sampleRate: 44100, bitDepth: 16, channels: 2, durationMs },
    art: art === null ? null : { hash: art, kind: 'embedded', relPath, mime: 'image/jpeg' },
    keepArt: false,
  };
}

function add(...songs: Song[]): void {
  writer.commit(songs.map(song));
}

function markMissing(relPath: string): void {
  db.prepare('UPDATE files SET missing_since = 1 WHERE rel_path = ?').run(relPath);
}

function refreshAlbums(): void {
  // What the end of a scan does after marking files missing.
  writer.finish({ missing: [], folderArt: [], artSources: [], issues: [], somethingChanged: true });
}

const titles = (tracks: { title: string }[]) => tracks.map(({ title }) => title);
const names = (artists: { name: string }[]) => artists.map(({ name }) => name);
const albumTitles = (albums: { title: string }[]) => albums.map(({ title }) => title);

function artistId(name: string): number {
  const artist = queries.artists().find((row) => row.name === name);
  if (!artist) throw new Error(`No artist ${name}`);
  return artist.id;
}

function albumId(title: string): number {
  const album = queries.albums({ artistId: null, genreId: null }).find((row) => row.title === title);
  if (!album) throw new Error(`No album ${title}`);
  return album.id;
}

function genreId(name: string): number {
  const genre = queries.genres().find((row) => row.name === name);
  if (!genre) throw new Error(`No genre ${name}`);
  return genre.id;
}

beforeEach(() => {
  ({ db } = openTestDatabase(tempDir('queries')));
  queries = createQueries(db);
  writes = createLibraryWrites(db);
  writer = createScanWriter(db, { now: () => 1, hostname: 'test' });
  nextPath = 1;
});

afterEach(() => closeTestDatabase(db));

describe('artists', () => {
  it('sorts by sort name, ignoring "the", case and diacritics', () => {
    add({ title: 'a', artist: 'Zebra' }, { title: 'b', artist: 'The Beatles' }, { title: 'c', artist: 'Björk' });
    add({ title: 'd', artist: 'abba' });
    expect(names(queries.artists())).toEqual(['abba', 'The Beatles', 'Björk', 'Zebra']);
  });

  it('counts albums and tracks', () => {
    add(
      { title: 'a', artist: 'X', album: 'One' },
      { title: 'b', artist: 'X', album: 'One' },
      { title: 'c', artist: 'X', album: 'Two' },
      { title: 'd', artist: 'X' },
    );
    expect(queries.artists()[0]).toMatchObject({ name: 'X', albumCount: 2, trackCount: 4 });
  });

  it('credits a guest for its tracks and the album they are on, and the album artist for all of it', () => {
    add(
      { title: 'a', artist: 'Host', album: 'Show' },
      { title: 'b', artist: 'Guest', albumArtist: 'Host', album: 'Show' },
    );
    const artists = queries.artists();
    expect(artists.find(({ name }) => name === 'Host')).toMatchObject({ albumCount: 1, trackCount: 2 });
    expect(artists.find(({ name }) => name === 'Guest')).toMatchObject({ albumCount: 1, trackCount: 1 });
  });

  it('does not count or list missing tracks', () => {
    add({ title: 'a', artist: 'X', path: 'a.flac' }, { title: 'b', artist: 'X', path: 'b.flac' });
    add({ title: 'c', artist: 'Gone', path: 'c.flac' });
    markMissing('a.flac');
    markMissing('c.flac');
    expect(queries.artists().map(({ name, trackCount }) => [name, trackCount])).toEqual([['X', 1]]);
  });

  it('finds one by id, and null when there is no such artist', () => {
    add({ title: 'a', artist: 'X' });
    const id = artistId('X');
    expect(queries.artist(id)).toMatchObject({ id, name: 'X', trackCount: 1 });
    expect(queries.artist(99999)).toBeNull();
  });

  it('takes its picture from an album, else a track', () => {
    add({ title: 'a', artist: 'X', album: 'One', year: 2000, art: 'aaaaaaaa' });
    add({ title: 'b', artist: 'Y', art: 'bbbbbbbb' });
    add({ title: 'c', artist: 'Z' });
    const artists = queries.artists();
    expect(artists.find(({ name }) => name === 'X')?.artHash).toBe('aaaaaaaa');
    expect(artists.find(({ name }) => name === 'Y')?.artHash).toBe('bbbbbbbb');
    expect(artists.find(({ name }) => name === 'Z')?.artHash).toBeNull();
  });

  it('merges case variants of a name into one row, as the column says', () => {
    add({ title: 'a', artist: 'Nightwish' }, { title: 'b', artist: 'NIGHTWISH' });
    expect(queries.artists().map(({ name, trackCount }) => [name, trackCount])).toEqual([['Nightwish', 2]]);
  });
});

describe('albums', () => {
  beforeEach(() => {
    add(
      { title: 'a', artist: 'The Zeros', album: 'Late', year: 2010, genres: ['Rock'] },
      { title: 'b', artist: 'The Zeros', album: 'Early', year: 1990, genres: ['Jazz'] },
      { title: 'c', artist: 'Abba', album: 'Waterloo', year: 1974, genres: ['Rock'] },
      { title: 'd', artist: 'Abba', album: 'Arrival', year: 1976 },
      { title: 'e', artist: 'Abba', album: 'Same Year', year: 1976 },
    );
  });

  it('sorts by artist, then year, then title', () => {
    expect(albumTitles(queries.albums({ artistId: null, genreId: null }))).toEqual([
      'Waterloo',
      'Arrival',
      'Same Year',
      'Early',
      'Late',
    ]);
  });

  it('sorts by year and title when filtered by artist', () => {
    expect(albumTitles(queries.albums({ artistId: artistId('The Zeros'), genreId: null }))).toEqual(['Early', 'Late']);
  });

  it('filters by genre', () => {
    expect(albumTitles(queries.albums({ artistId: null, genreId: genreId('Rock') }))).toEqual(['Waterloo', 'Late']);
  });

  it('filters by both', () => {
    expect(albumTitles(queries.albums({ artistId: artistId('Abba'), genreId: genreId('Rock') }))).toEqual(['Waterloo']);
  });

  it('shows a guest the albums it appears on', () => {
    add({ title: 'x', artist: 'Guest', albumArtist: 'Abba', album: 'Arrival', year: 1976 });
    expect(albumTitles(queries.albums({ artistId: artistId('Guest'), genreId: null }))).toEqual(['Arrival']);
  });

  it('summarizes the present tracks only, and hides an album with none', () => {
    add({ title: 'p', artist: 'M', album: 'Half', path: 'p.flac', durationMs: 1000, year: 1 + 2000 });
    add({ title: 'q', artist: 'M', album: 'Half', path: 'q.flac', durationMs: 3000, year: 1999 });
    add({ title: 'r', artist: 'M', album: 'Gone', path: 'r.flac' });
    markMissing('q.flac');
    markMissing('r.flac');
    refreshAlbums();

    const albums = queries.albums({ artistId: artistId('M'), genreId: null });
    expect(albumTitles(albums)).toEqual(['Half']);
    expect(albums[0]).toMatchObject({ trackCount: 1, durationMs: 1000, year: 2001 });
  });

  it('finds one by id, and null when there is no such album', () => {
    const id = albumId('Late');
    expect(queries.album(id)).toMatchObject({ title: 'Late', artist: 'The Zeros', year: 2010, trackCount: 1 });
    expect(queries.album(99999)).toBeNull();
  });
});

describe('genres', () => {
  it('sorts by name without minding case, and counts present tracks', () => {
    add(
      { title: 'a', genres: ['rock', 'Ambient'], path: 'a.flac' },
      { title: 'b', genres: ['Ambient'], path: 'b.flac' },
    );
    add({ title: 'c', genres: ['Zydeco'], path: 'c.flac' });
    markMissing('b.flac');
    markMissing('c.flac');
    expect(queries.genres().map(({ name, trackCount }) => [name, trackCount])).toEqual([
      ['Ambient', 1],
      ['rock', 1],
    ]);
  });
});

describe('tracks', () => {
  it('orders an album by disc, track, then title', () => {
    add(
      { title: 'd2 t1', artist: 'X', album: 'A', disc: 2, track: 1 },
      { title: 'd1 t2', artist: 'X', album: 'A', disc: 1, track: 2 },
      { title: 'no disc t3', artist: 'X', album: 'A', track: 3 },
      { title: 'd1 t1', artist: 'X', album: 'A', disc: 1, track: 1 },
      { title: 'b no number', artist: 'X', album: 'A', disc: 1 },
      { title: 'a no number', artist: 'X', album: 'A', disc: 1 },
    );
    expect(titles(queries.tracks({ kind: 'album', albumId: albumId('A') }))).toEqual([
      'd1 t1',
      'd1 t2',
      'no disc t3',
      'a no number',
      'b no number',
      'd2 t1',
    ]);
  });

  it('orders an artist by album year, album title, disc, track', () => {
    add(
      { title: 'late', artist: 'X', album: 'Z Late', year: 2005, track: 1 },
      { title: 'early 2', artist: 'X', album: 'B Early', year: 1990, track: 2 },
      { title: 'early 1', artist: 'X', album: 'B Early', year: 1990, track: 1 },
      { title: 'same year', artist: 'X', album: 'A Same', year: 1990, track: 1 },
      { title: 'other artist', artist: 'Y', album: 'Other', year: 1950 },
    );
    expect(titles(queries.tracks({ kind: 'artist', artistId: artistId('X') }))).toEqual([
      'same year',
      'early 1',
      'early 2',
      'late',
    ]);
  });

  it('includes what an artist is album artist of', () => {
    add({ title: 'guest track', artist: 'Guest', albumArtist: 'Host', album: 'Show', track: 1 });
    expect(titles(queries.tracks({ kind: 'artist', artistId: artistId('Host') }))).toEqual(['guest track']);
    expect(titles(queries.tracks({ kind: 'artist', artistId: artistId('Guest') }))).toEqual(['guest track']);
  });

  it('orders everything by artist, album year, album title, disc, track', () => {
    add(
      { title: 'z', artist: 'Zed', album: 'Zed Album', year: 2000, track: 1 },
      { title: 'beatles 2', artist: 'The Beatles', album: 'Help', year: 1965, track: 2 },
      { title: 'beatles 1', artist: 'The Beatles', album: 'Help', year: 1965, track: 1 },
      { title: 'beatles early', artist: 'The Beatles', album: 'Please', year: 1963, track: 9 },
      { title: 'abba', artist: 'Abba', album: 'Arrival', year: 1976, track: 1 },
    );
    expect(titles(queries.tracks({ kind: 'all' }))).toEqual(['abba', 'beatles early', 'beatles 1', 'beatles 2', 'z']);
  });

  it('keeps a compilation together under its album artist', () => {
    add(
      { title: 'three', artist: 'Abba', albumArtist: 'Various Artists', album: 'Comp', track: 3 },
      { title: 'one', artist: 'Zed', albumArtist: 'Various Artists', album: 'Comp', track: 1 },
      { title: 'two', artist: 'Abba', albumArtist: 'Various Artists', album: 'Comp', track: 2 },
      { title: 'other', artist: 'Mid', album: 'Other', track: 1 },
    );
    expect(titles(queries.tracks({ kind: 'all' }))).toEqual(['other', 'one', 'two', 'three']);
  });

  it('orders a genre the same way as everything', () => {
    add(
      { title: 'z', artist: 'Zed', album: 'Z', year: 2000, track: 1, genres: ['Rock'] },
      { title: 'a', artist: 'Abba', album: 'A', year: 1976, track: 1, genres: ['Rock'] },
      { title: 'not rock', artist: 'Abba', album: 'B', year: 1977, track: 1, genres: ['Pop'] },
    );
    expect(titles(queries.tracks({ kind: 'genre', genreId: genreId('Rock') }))).toEqual(['a', 'z']);
  });

  it('orders missing tracks by path, and leaves them out of every other list', () => {
    add(
      { title: 'b', artist: 'X', album: 'A', path: 'b.flac', genres: ['Rock'] },
      { title: 'a', artist: 'X', album: 'A', path: 'a.flac', genres: ['Rock'] },
      { title: 'here', artist: 'X', album: 'A', path: 'here.flac', genres: ['Rock'] },
    );
    const artist = artistId('X');
    const album = albumId('A');
    const genre = genreId('Rock');
    markMissing('b.flac');
    markMissing('a.flac');

    expect(titles(queries.tracks({ kind: 'missing' }))).toEqual(['a', 'b']);
    expect(queries.tracks({ kind: 'missing' })[0]).toMatchObject({ isMissing: true });
    for (const filter of [
      { kind: 'all' },
      { kind: 'artist', artistId: artist },
      { kind: 'album', albumId: album },
      { kind: 'genre', genreId: genre },
    ] as const) {
      expect(titles(queries.tracks(filter))).toEqual(['here']);
    }
    expect(queries.counts()).toEqual({ tracks: 1, albums: 1, artists: 1, missing: 2 });
  });

  it('fills in a whole track', () => {
    add({
      title: 'Song',
      artist: 'Guest',
      albumArtist: 'Host',
      album: 'Show',
      year: 1999,
      disc: 2,
      track: 3,
      genres: ['Rock', 'Pop'],
      path: 'Host/Show/song.flac',
      art: 'abcdef0123',
      durationMs: 1234,
    });
    db.prepare("UPDATE art SET color = '#123456'").run();
    const [track] = queries.tracks({ kind: 'all' });
    expect(track).toEqual({
      id: expect.any(Number) as number,
      title: 'Song',
      artistId: artistId('Guest'),
      artist: 'Guest',
      albumId: albumId('Show'),
      album: 'Show',
      albumArtist: 'Host',
      year: 1999,
      discNumber: 2,
      trackNumber: 3,
      durationMs: 1234,
      artHash: 'abcdef0123',
      artColor: '#123456',
      genres: ['Rock', 'Pop'],
      codec: 'FLAC',
      sampleRate: 44100,
      bitDepth: 16,
      isCueTrack: false,
      isMissing: false,
      relPath: 'Host/Show/song.flac',
    });
  });
});

describe('playableTracks', () => {
  it('says where in its file each track is, in the order asked for, repeats and missing tracks included', () => {
    writer.commit([song({ title: 'Whole', path: 'whole.flac' }), song({ title: 'Album', path: 'album.flac' })]);
    const ids = Object.fromEntries(queries.tracksByIds([1, 2]).map(({ title, id }) => [title, id])) as Record<
      string,
      number
    >;
    const whole = ids.Whole as number;
    const first = ids.Album as number;
    db.prepare('UPDATE tracks SET cue_index = 1, end_ms = 60000 WHERE id = ?').run(first);
    const inserted = db
      .prepare(
        `INSERT INTO tracks (file_id, cue_index, start_ms, end_ms, title, sort_title, artist_id)
         SELECT file_id, 2, 60000, NULL, 'Second', 'second', artist_id FROM tracks WHERE id = ?`,
      )
      .run(first);
    const second = Number(inserted.lastInsertRowid);
    writes.markMissing(whole, 1);

    const playable = queries.playableTracks([second, whole, first, whole, 99999]);
    expect(playable.map(({ track }) => track.id)).toEqual([second, whole, first, whole]);
    expect(playable[0]?.range).toMatchObject({ startMs: 60000, endMs: null });
    expect(playable[2]?.range).toMatchObject({ startMs: 0, endMs: 60000 });
    expect(playable[0]?.range.fileId).toBe(playable[2]?.range.fileId);
    expect(playable[1]?.range).toMatchObject({ startMs: 0, endMs: null });
    expect(playable[1]?.range.fileId).not.toBe(playable[0]?.range.fileId);
    expect(playable[1]?.track.isMissing).toBe(true);
    expect(playable[0]?.track).toMatchObject({ title: 'Second', isCueTrack: true });
    expect(Object.keys(playable[0]?.track ?? {})).not.toContain('fileId');
  });

  it('has nothing to say about nothing', () => {
    expect(queries.playableTracks([])).toEqual([]);
  });
});

describe('tracksByIds', () => {
  it('keeps the given order and repeats, drops unknown ids, and includes missing tracks', () => {
    add({ title: 'a', path: 'a.flac' }, { title: 'b', path: 'b.flac' }, { title: 'c', path: 'c.flac' });
    markMissing('b.flac');
    const ids = Object.fromEntries(queries.tracksByIds([1, 2, 3]).map(({ title, id }) => [title, id])) as Record<
      string,
      number
    >;
    const { a, b, c } = ids as { a: number; b: number; c: number };

    expect(queries.tracksByIds([c, a, b, a, 99999]).map(({ title, isMissing }) => [title, isMissing])).toEqual([
      ['c', false],
      ['a', false],
      ['b', true],
      ['a', false],
    ]);
    expect(queries.tracksByIds([])).toEqual([]);
  });
});

describe('search', () => {
  beforeEach(() => {
    add(
      { title: 'Jóga', artist: 'Björk', album: 'Homogenic', year: 1997, track: 1 },
      { title: 'Hunter', artist: 'Björk', album: 'Homogenic', year: 1997, track: 2 },
      { title: 'Human', artist: 'Nightwish', album: 'Human II Nature', year: 2020, track: 1 },
      { title: 'Music', artist: 'Nightwish', album: 'Human II Nature', year: 2020, track: 2 },
      { title: 'Hunter of Stars', artist: 'Someone Else', album: 'Elsewhere' },
    );
  });

  it('returns nothing, and no error, for empty or punctuation-only input', () => {
    for (const input of ['', '   ', '!!!', '"', '***', '( )', '-', '"" ""', '\u0000']) {
      expect(queries.search(input)).toEqual(NOTHING_FOUND);
    }
  });

  it('finds "Björk" from "bjork"', () => {
    const { artists, albums, tracks } = queries.search('bjork');
    expect(names(artists)).toEqual(['Björk']);
    expect(albums).toEqual([]);
    expect(titles(tracks).toSorted()).toEqual(['Hunter', 'Jóga']);
  });

  it('finds names the way they get typed', () => {
    add(
      { title: 'Thunderstruck', artist: 'AC/DC', album: 'The Razors Edge' },
      { title: 'Losing My Religion', artist: 'R.E.M.', album: 'Out of Time' },
      { title: '27 Club', artist: 'Chløë Black', album: 'Single' },
      { title: 'Lean On', artist: 'MØ', album: 'Peace Is the Mission' },
    );
    expect(names(queries.search('acdc').artists)).toEqual(['AC/DC']);
    expect(names(queries.search('ac/dc').artists)).toEqual(['AC/DC']);
    expect(names(queries.search('ac dc').artists)).toEqual(['AC/DC']);
    expect(names(queries.search('rem').artists)).toEqual(['R.E.M.']);
    expect(names(queries.search('r.e.m').artists)).toEqual(['R.E.M.']);
    expect(names(queries.search('chloe').artists)).toEqual(['Chløë Black']);
    expect(names(queries.search('chløë').artists)).toEqual(['Chløë Black']);
    expect(names(queries.search('mø').artists)).toEqual(['MØ']);
  });

  it('finds artists from the artist column', () => {
    expect(names(queries.search('night').artists)).toEqual(['Nightwish']);
    expect(names(queries.search('hunter').artists)).toEqual([]);
  });

  it('finds albums from the album column', () => {
    expect(albumTitles(queries.search('homog').albums)).toEqual(['Homogenic']);
    expect(albumTitles(queries.search('human').albums)).toEqual(['Human II Nature']);
    expect(albumTitles(queries.search('nightwish').albums)).toEqual([]);
  });

  it('finds an album named along with its artist', () => {
    expect(albumTitles(queries.search('nightwish human').albums)).toEqual(['Human II Nature']);
    expect(names(queries.search('nightwish human').artists)).toEqual([]);
  });

  it('finds tracks across columns, needing every word', () => {
    expect(titles(queries.search('nightwish music').tracks)).toEqual(['Music']);
    expect(titles(queries.search('bjork music').tracks)).toEqual([]);
  });

  it('matches prefixes', () => {
    expect(titles(queries.search('hunt').tracks).toSorted()).toEqual(['Hunter', 'Hunter of Stars']);
  });

  it('leaves out missing files', () => {
    db.prepare(
      "UPDATE files SET missing_since = 1 WHERE id = (SELECT file_id FROM tracks WHERE title = 'Hunter')",
    ).run();
    db.prepare("UPDATE files SET missing_since = 1 WHERE id = (SELECT file_id FROM tracks WHERE title = 'Jóga')").run();
    expect(queries.search('bjork')).toEqual(NOTHING_FOUND);
    expect(queries.search('homogenic')).toEqual(NOTHING_FOUND);
  });

  it('caps what it returns', () => {
    const many: Song[] = [];
    for (let index = 0; index < 250; index++) {
      many.push({ title: `capped ${index}`, artist: `capped artist ${index}`, album: `capped album ${index}` });
    }
    add(...many);
    const { artists, albums, tracks, more } = queries.search('capped');
    expect(artists).toHaveLength(20);
    expect(albums).toHaveLength(30);
    expect(tracks).toHaveLength(200);
    expect(more).toEqual({ artists: true, albums: true, tracks: true });
  });

  it('does not call a list cut off when it only ends at the limit', () => {
    const many: Song[] = [];
    for (let index = 0; index < 200; index++) many.push({ title: `exact ${index}`, artist: 'Someone' });
    add(...many);
    const { tracks, more } = queries.search('exact');
    expect(tracks).toHaveLength(200);
    expect(more.tracks).toBe(false);
  });
});

describe('removeMissing', () => {
  it('deletes missing files and, through cascades, their tracks and playlist items', () => {
    add(
      {
        title: 'gone',
        artist: 'Gone Artist',
        album: 'Gone Album',
        genres: ['Gone Genre'],
        path: 'gone.flac',
        art: 'aaaaaaaa',
      },
      { title: 'here', artist: 'Here', path: 'here.flac' },
    );
    const [gone] = queries.search('gone').tracks;
    const goneId = gone?.id ?? 0;
    const playlist = Number(
      db.prepare("INSERT INTO playlists (name, created_at, updated_at) VALUES ('p', 1, 1)").run().lastInsertRowid,
    );
    db.prepare('INSERT INTO playlist_items (playlist_id, track_id, position) VALUES (?, ?, 0)').run(playlist, goneId);
    db.prepare('INSERT INTO play_events (track_id, played_at, listened_ms) VALUES (?, 1, 1)').run(goneId);
    db.prepare("INSERT INTO lyrics (track_id, status, fetched_at) VALUES (?, 'not_found', 1)").run(goneId);

    markMissing('gone.flac');
    expect(writes.removeMissing()).toBe(1);

    const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    expect(count('files')).toBe(1);
    expect(count('tracks')).toBe(1);
    expect(count('tracks_fts')).toBe(1);
    expect(count('playlist_items')).toBe(0);
    expect(count('play_events')).toBe(0);
    expect(count('lyrics')).toBe(0);
    expect(count('track_genres')).toBe(0);
    expect(count('genres')).toBe(0);
    expect(count('albums')).toBe(0);
    expect(count('art')).toBe(0);
    expect(names(queries.artists())).toEqual(['Here']);
    expect(count('playlists')).toBe(1);
    expect(queries.search('gone').tracks).toEqual([]);
  });

  it('does nothing when nothing is missing', () => {
    add({ title: 'here' });
    expect(writes.removeMissing()).toBe(0);
    expect(queries.counts().tracks).toBe(1);
  });
});

describe('the rest', () => {
  it('finds the path of a track', () => {
    add({ title: 'a', path: 'Some Folder/a.flac' });
    const [track] = queries.tracks({ kind: 'all' });
    expect(queries.relPathOfTrack(track?.id ?? 0)).toBe('Some Folder/a.flac');
    expect(queries.relPathOfTrack(99999)).toBeNull();
  });

  it('knows when the library is empty', () => {
    expect(queries.isEmpty()).toBe(true);
    add({ title: 'a' });
    expect(queries.isEmpty()).toBe(false);
  });

  it('marks a track missing once', () => {
    add({ title: 'a' });
    const [track] = queries.tracks({ kind: 'all' });
    expect(writes.markMissing(track?.id ?? 0, 5)).toBe(true);
    expect(writes.markMissing(track?.id ?? 0, 6)).toBe(false);
    expect(queries.tracks({ kind: 'missing' })).toHaveLength(1);
    expect(writes.markMissing(99999, 5)).toBe(false);
  });
});
