/* What the library serves, on main. It's all synchronous, so it has to stay fast. */

import type {
  AlbumSummary,
  ArtistSummary,
  GenreSummary,
  ScanIssue,
  SearchResults,
  Track,
  TrackFilter,
} from '@shared/domain';
import type { Connection } from '@main/db/connection';
import { ftsQueries } from '@main/library/ftsQuery';
import { createLibraryMeta } from '@main/library/libraryMeta';
import { createOrphanPruner } from '@main/library/orphans';

const MAX_SEARCH_ARTISTS = 20;
const MAX_SEARCH_ALBUMS = 30;
const MAX_SEARCH_TRACKS = 200;
const GENRE_SEPARATOR = '\x1f';

type TrackRow = Omit<Track, 'genres' | 'isCueTrack' | 'isMissing'> & {
  genres: string | null;
  cueIndex: number;
  missingSince: number | null;
};

function toTrack({ genres, cueIndex, missingSince, ...row }: TrackRow): Track {
  return {
    ...row,
    genres: genres === null ? [] : genres.split(GENRE_SEPARATOR),
    isCueTrack: cueIndex > 0,
    isMissing: missingSince !== null,
  };
}

const TRACK_COLUMNS = `
  t.id, t.title, t.artist_id AS artistId, ar.name AS artist, t.album_id AS albumId, al.title AS album,
  aa.name AS albumArtist, t.year, t.disc_number AS discNumber, t.track_number AS trackNumber,
  COALESCE(t.end_ms, f.duration_ms) - t.start_ms AS durationMs,
  f.art_hash AS artHash, art.color AS artColor, f.codec, f.sample_rate AS sampleRate, f.bit_depth AS bitDepth,
  t.cue_index AS cueIndex, f.missing_since AS missingSince, f.rel_path AS relPath,
  (SELECT group_concat(g.name, char(31)) FROM track_genres tg JOIN genres g ON g.id = tg.genre_id WHERE tg.track_id = t.id) AS genres`;

const TRACK_TABLES = `
  FROM tracks t
  JOIN files f ON f.id = t.file_id
  JOIN artists ar ON ar.id = t.artist_id
  LEFT JOIN albums al ON al.id = t.album_id
  LEFT JOIN artists aa ON aa.id = al.artist_id
  LEFT JOIN art ON art.hash = f.art_hash`;

const PRESENT = 'f.missing_since IS NULL';

// Numbered tracks first, so a track with no number never jumps ahead of track 1.
const DISC_AND_TRACK = 'COALESCE(t.disc_number, 1), COALESCE(t.track_number, 1000000), t.sort_title';
const ALBUM_ORDER = `al.year, al.sort_title, al.id, ${DISC_AND_TRACK}`;
const LIBRARY_ORDER = `COALESCE(aa.sort_name, ar.sort_name), COALESCE(aa.id, ar.id), ${ALBUM_ORDER}, t.id`;

/** Where in its file a track is. A normal file is all of it: 0 to null. */
export type TrackRange = {
  fileId: number;
  startMs: number;
  endMs: number | null;
};

export type PlayableTrack = {
  track: Track;
  range: TrackRange;
};

type PlayableRow = TrackRow & TrackRange;

function trackSql(where: string, orderBy: string): string {
  return `SELECT ${TRACK_COLUMNS} ${TRACK_TABLES} WHERE ${where} ORDER BY ${orderBy}`;
}

const ARTIST_SUMMARY = `
  WITH present AS (
    SELECT t.id AS track_id, t.artist_id, t.album_id, al.artist_id AS album_artist_id
    FROM tracks t
    JOIN files f ON f.id = t.file_id
    LEFT JOIN albums al ON al.id = t.album_id
    WHERE ${PRESENT}
  ),
  credited AS (
    SELECT artist_id, track_id, album_id FROM present
    UNION
    SELECT album_artist_id, track_id, album_id FROM present WHERE album_artist_id IS NOT NULL
  )
  SELECT ar.id, ar.name, COUNT(DISTINCT c.album_id) AS albumCount, COUNT(DISTINCT c.track_id) AS trackCount,
    COALESCE(
      (SELECT a.art_hash FROM albums a
       WHERE a.artist_id = ar.id AND a.art_hash IS NOT NULL ORDER BY a.year, a.sort_title LIMIT 1),
      (SELECT f.art_hash FROM tracks t JOIN files f ON f.id = t.file_id
       WHERE t.artist_id = ar.id AND f.art_hash IS NOT NULL AND ${PRESENT} ORDER BY t.sort_title LIMIT 1)
    ) AS artHash
  FROM credited c JOIN artists ar ON ar.id = c.artist_id`;

const ALBUM_SUMMARY = `
  SELECT al.id, al.title, al.artist_id AS artistId, ar.name AS artist, al.year, al.art_hash AS artHash,
    art.color AS artColor, COUNT(*) AS trackCount,
    SUM(COALESCE(t.end_ms, f.duration_ms) - t.start_ms) AS durationMs
  FROM albums al
  JOIN artists ar ON ar.id = al.artist_id
  JOIN tracks t ON t.album_id = al.id
  JOIN files f ON f.id = t.file_id AND ${PRESENT}
  LEFT JOIN art ON art.hash = al.art_hash`;

const HAS_TRACK_BY_ARTIST = `EXISTS (
  SELECT 1 FROM tracks x JOIN files xf ON xf.id = x.file_id
  WHERE x.album_id = al.id AND x.artist_id = @artistId AND xf.missing_since IS NULL
)`;
const ALBUM_OF_ARTIST = `(al.artist_id = @artistId OR ${HAS_TRACK_BY_ARTIST})`;
const ALBUM_IN_GENRE = `EXISTS (
  SELECT 1 FROM tracks x
  JOIN track_genres xg ON xg.track_id = x.id
  JOIN files xf ON xf.id = x.file_id
  WHERE x.album_id = al.id AND xg.genre_id = @genreId AND xf.missing_since IS NULL
)`;
const ALBUMS_BY_ARTIST_ORDER = 'al.year, al.sort_title';
const ALBUMS_ORDER = `ar.sort_name, ${ALBUMS_BY_ARTIST_ORDER}`;

function albumSql(where: string, orderBy: string): string {
  return `${ALBUM_SUMMARY} WHERE ${where} GROUP BY al.id ORDER BY ${orderBy}`;
}

type StoredCounts = {
  tracks: number;
  albums: number;
  artists: number;
  missing: number;
};

type ArtRow = {
  hash: string;
  mime: string;
  color: string | null;
  sourceKind: 'embedded' | 'folder';
  sourceRelPath: string;
};

export type LibraryQueries = ReturnType<typeof createQueries>;

export function createQueries(db: Connection) {
  const statements = {
    artists: db.prepare<[], ArtistSummary>(`${ARTIST_SUMMARY} GROUP BY ar.id ORDER BY ar.sort_name, ar.id`),
    artist: db.prepare<[number], ArtistSummary>(`${ARTIST_SUMMARY} WHERE ar.id = ? GROUP BY ar.id`),
    artistsByIds: db.prepare<[string], ArtistSummary>(
      `${ARTIST_SUMMARY} WHERE ar.id IN (SELECT value FROM json_each(?)) GROUP BY ar.id ORDER BY ar.sort_name, ar.id`,
    ),

    albums: db.prepare<[], AlbumSummary>(albumSql('1', ALBUMS_ORDER)),
    albumsByArtist: db.prepare<[{ artistId: number }], AlbumSummary>(albumSql(ALBUM_OF_ARTIST, ALBUMS_BY_ARTIST_ORDER)),
    albumsByGenre: db.prepare<[{ genreId: number }], AlbumSummary>(albumSql(ALBUM_IN_GENRE, ALBUMS_ORDER)),
    albumsByArtistAndGenre: db.prepare<[{ artistId: number; genreId: number }], AlbumSummary>(
      albumSql(`${ALBUM_OF_ARTIST} AND ${ALBUM_IN_GENRE}`, ALBUMS_BY_ARTIST_ORDER),
    ),
    album: db.prepare<[number], AlbumSummary>(albumSql('al.id = ?', ALBUMS_ORDER)),
    albumsByIds: db.prepare<[string], AlbumSummary>(
      albumSql('al.id IN (SELECT value FROM json_each(?))', ALBUMS_ORDER),
    ),

    genres: db.prepare<[], GenreSummary>(
      `SELECT g.id, g.name, COUNT(*) AS trackCount
       FROM genres g
       JOIN track_genres tg ON tg.genre_id = g.id
       JOIN tracks t ON t.id = tg.track_id
       JOIN files f ON f.id = t.file_id AND ${PRESENT}
       GROUP BY g.id ORDER BY g.name`,
    ),

    allTracks: db.prepare<[], TrackRow>(trackSql(PRESENT, LIBRARY_ORDER)),
    tracksByArtist: db.prepare<[{ artistId: number }], TrackRow>(
      trackSql(`${PRESENT} AND (t.artist_id = @artistId OR al.artist_id = @artistId)`, `${ALBUM_ORDER}, t.id`),
    ),
    tracksByAlbum: db.prepare<[number], TrackRow>(trackSql(`${PRESENT} AND t.album_id = ?`, `${DISC_AND_TRACK}, t.id`)),
    tracksByGenre: db.prepare<[number], TrackRow>(
      trackSql(`${PRESENT} AND t.id IN (SELECT track_id FROM track_genres WHERE genre_id = ?)`, LIBRARY_ORDER),
    ),
    missingTracks: db.prepare<[], TrackRow>(trackSql('f.missing_since IS NOT NULL', 'f.rel_path, t.id')),
    tracksByIds: db.prepare<[string], TrackRow>(trackSql('t.id IN (SELECT value FROM json_each(?))', 't.id')),
    playableTracks: db.prepare<[string], PlayableRow>(
      `SELECT ${TRACK_COLUMNS}, t.file_id AS fileId, t.start_ms AS startMs, t.end_ms AS endMs
       ${TRACK_TABLES} WHERE t.id IN (SELECT value FROM json_each(?))`,
    ),

    searchTracks: db.prepare<[string, number], TrackRow>(
      `SELECT ${TRACK_COLUMNS}
       FROM tracks_fts m
       JOIN tracks t ON t.id = m.rowid
       JOIN files f ON f.id = t.file_id
       JOIN artists ar ON ar.id = t.artist_id
       LEFT JOIN albums al ON al.id = t.album_id
       LEFT JOIN artists aa ON aa.id = al.artist_id
       LEFT JOIN art ON art.hash = f.art_hash
       WHERE tracks_fts MATCH ? AND ${PRESENT}
       ORDER BY m.rank, t.sort_title
       LIMIT ?`,
    ),
    searchArtistIds: db.prepare<[string, number], { id: number }>(
      `SELECT DISTINCT ar.id, ar.sort_name
       FROM tracks_fts m
       JOIN tracks t ON t.id = m.rowid
       JOIN files f ON f.id = t.file_id
       JOIN artists ar ON ar.id = t.artist_id
       WHERE tracks_fts MATCH ? AND ${PRESENT}
       ORDER BY ar.sort_name
       LIMIT ?`,
    ),
    searchAlbumIds: db.prepare<[string, number], { id: number }>(
      `SELECT DISTINCT al.id, al.sort_title
       FROM tracks_fts m
       JOIN tracks t ON t.id = m.rowid
       JOIN files f ON f.id = t.file_id
       JOIN albums al ON al.id = t.album_id
       WHERE tracks_fts MATCH ? AND ${PRESENT}
       ORDER BY al.sort_title
       LIMIT ?`,
    ),

    issues: db.prepare<[], ScanIssue>(
      'SELECT rel_path AS relPath, kind, message FROM scan_issues ORDER BY kind, rel_path',
    ),
    relPathOfTrack: db.prepare<[number], { relPath: string }>(
      'SELECT f.rel_path AS relPath FROM tracks t JOIN files f ON f.id = t.file_id WHERE t.id = ?',
    ),

    hasFiles: db.prepare<[], { found: number }>('SELECT 1 AS found FROM files LIMIT 1'),
    counts: db.prepare<[], StoredCounts>(
      `SELECT
         (SELECT COUNT(*) FROM tracks t JOIN files f ON f.id = t.file_id WHERE ${PRESENT}) AS tracks,
         (SELECT COUNT(DISTINCT t.album_id) FROM tracks t JOIN files f ON f.id = t.file_id WHERE ${PRESENT}) AS albums,
         (SELECT COUNT(*) FROM (
            SELECT t.artist_id FROM tracks t JOIN files f ON f.id = t.file_id WHERE ${PRESENT}
            UNION
            SELECT al.artist_id FROM tracks t JOIN files f ON f.id = t.file_id JOIN albums al ON al.id = t.album_id WHERE ${PRESENT}
         )) AS artists,
         (SELECT COUNT(*) FROM tracks t JOIN files f ON f.id = t.file_id WHERE f.missing_since IS NOT NULL) AS missing`,
    ),

    artRow: db.prepare<[string], ArtRow>(
      `SELECT hash, mime, color, source_kind AS sourceKind, source_rel_path AS sourceRelPath FROM art WHERE hash = ?`,
    ),
    artRows: db.prepare<[], ArtRow>(
      `SELECT hash, mime, color, source_kind AS sourceKind, source_rel_path AS sourceRelPath FROM art`,
    ),
    otherFilesWithArt: db.prepare<[string, number], { relPath: string; artSource: 'embedded' | 'folder' }>(
      `SELECT rel_path AS relPath, art_source AS artSource FROM files
       WHERE art_hash = ? AND missing_since IS NULL LIMIT ?`,
    ),
  };

  const meta = createLibraryMeta(db);

  function tracks(filter: TrackFilter): Track[] {
    switch (filter.kind) {
      case 'all':
        return statements.allTracks.all().map(toTrack);
      case 'artist':
        return statements.tracksByArtist.all({ artistId: filter.artistId }).map(toTrack);
      case 'album':
        return statements.tracksByAlbum.all(filter.albumId).map(toTrack);
      case 'genre':
        return statements.tracksByGenre.all(filter.genreId).map(toTrack);
      case 'missing':
        return statements.missingTracks.all().map(toTrack);
    }
  }

  function albums({ artistId, genreId }: { artistId: number | null; genreId: number | null }): AlbumSummary[] {
    if (artistId !== null && genreId !== null) return statements.albumsByArtistAndGenre.all({ artistId, genreId });
    if (artistId !== null) return statements.albumsByArtist.all({ artistId });
    if (genreId !== null) return statements.albumsByGenre.all({ genreId });
    return statements.albums.all();
  }

  function search(input: string): SearchResults {
    const queries = ftsQueries(input);
    if (queries === null) {
      return { artists: [], albums: [], tracks: [], more: { artists: false, albums: false, tracks: false } };
    }

    // One past each limit, to tell a list that ends there from one that was cut off.
    const artistIds = statements.searchArtistIds.all(queries.artists, MAX_SEARCH_ARTISTS + 1).map(({ id }) => id);
    const albumIds = statements.searchAlbumIds.all(queries.albums, MAX_SEARCH_ALBUMS + 1).map(({ id }) => id);
    const foundTracks = statements.searchTracks.all(queries.tracks, MAX_SEARCH_TRACKS + 1).map(toTrack);
    return {
      artists: statements.artistsByIds.all(JSON.stringify(artistIds.slice(0, MAX_SEARCH_ARTISTS))),
      albums: statements.albumsByIds.all(JSON.stringify(albumIds.slice(0, MAX_SEARCH_ALBUMS))),
      tracks: foundTracks.slice(0, MAX_SEARCH_TRACKS),
      more: {
        artists: artistIds.length > MAX_SEARCH_ARTISTS,
        albums: albumIds.length > MAX_SEARCH_ALBUMS,
        tracks: foundTracks.length > MAX_SEARCH_TRACKS,
      },
    };
  }

  /** In the order asked for, repeats included. Missing tracks are in here too: a queue or playlist has to show them. */
  function tracksByIds(ids: number[]): Track[] {
    const found = new Map(statements.tracksByIds.all(JSON.stringify(ids)).map((row) => [row.id, toTrack(row)]));
    return ids.flatMap((id) => found.get(id) ?? []);
  }

  /** The same, with where each track is in its file, for playing them. */
  function playableTracks(ids: number[]): PlayableTrack[] {
    const found = new Map<number, PlayableTrack>();
    for (const { fileId, startMs, endMs, ...row } of statements.playableTracks.all(JSON.stringify(ids))) {
      found.set(row.id, { track: toTrack(row), range: { fileId, startMs, endMs } });
    }
    return ids.flatMap((id) => found.get(id) ?? []);
  }

  return {
    artists: () => statements.artists.all(),
    artist: (id: number) => statements.artist.get(id) ?? null,
    albums,
    album: (id: number) => statements.album.get(id) ?? null,
    genres: () => statements.genres.all(),
    tracks,
    tracksByIds,
    playableTracks,
    search,
    issues: () => statements.issues.all(),
    relPathOfTrack: (id: number) => statements.relPathOfTrack.get(id)?.relPath ?? null,

    isEmpty: () => statements.hasFiles.get() === undefined,
    counts: () => statements.counts.get() ?? { tracks: 0, albums: 0, artists: 0, missing: 0 },
    lastScanAt: meta.lastScanAt,
    lastChanged: meta.lastChanged,
    lastScanReport: meta.lastScanReport,

    artRow: (hash: string) => statements.artRow.get(hash) ?? null,
    artRows: () => statements.artRows.all(),
    otherFilesWithArt: (hash: string, limit: number) => statements.otherFilesWithArt.all(hash, limit),
  };
}

export type LibraryWrites = ReturnType<typeof createLibraryWrites>;

/** Apart from the reads, so nothing outside Library can change the database without Library saying so. */
export function createLibraryWrites(db: Connection) {
  const statements = {
    setArtColor: db.prepare<[string, string]>('UPDATE art SET color = ? WHERE hash = ?'),
    markMissing: db.prepare<[number, number]>(
      `UPDATE files SET missing_since = ?
       WHERE id = (SELECT file_id FROM tracks WHERE id = ?) AND missing_since IS NULL`,
    ),
    countMissingTracks: db.prepare<[], { count: number }>(
      'SELECT COUNT(*) AS count FROM tracks t JOIN files f ON f.id = t.file_id WHERE f.missing_since IS NOT NULL',
    ),
    deleteMissingFts: db.prepare<[]>(
      `DELETE FROM tracks_fts WHERE rowid IN (
         SELECT t.id FROM tracks t JOIN files f ON f.id = t.file_id WHERE f.missing_since IS NOT NULL
       )`,
    ),
    deleteMissingFiles: db.prepare<[]>('DELETE FROM files WHERE missing_since IS NOT NULL'),
  };

  const meta = createLibraryMeta(db);
  const pruneOrphans = createOrphanPruner(db);

  const removeMissing = db.transaction((): number => {
    const { count } = statements.countMissingTracks.get() ?? { count: 0 };
    statements.deleteMissingFts.run();
    statements.deleteMissingFiles.run();
    pruneOrphans();
    return count;
  });

  return {
    markChanged: meta.markChanged,
    setLastScanReport: meta.setLastScanReport,
    setArtColor: (hash: string, color: string) => statements.setArtColor.run(color, hash),
    markMissing: (trackId: number, at: number) => statements.markMissing.run(at, trackId).changes > 0,
    removeMissing: () => removeMissing.immediate(),
  };
}
