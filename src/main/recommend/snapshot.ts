/* The whole library as the engine wants it, read at once on the worker's own connection. Owned is worked out here, each read. */

import Database from 'better-sqlite3';
import { BUSY_TIMEOUT_MS } from '@main/db/connection';
import { FINGERPRINT_MODEL } from '@main/fingerprints/model';
import { EMBEDDING_SIZE } from '@main/fingerprints/melSpectrogram';
import { mainGenreOf } from '@shared/genres';
import { artistKey, titleKey } from '@main/library/names';
import {
  artistProfiles,
  type ArtistLinkRow,
  type ArtistProfile,
  type OwnedSong,
  type TrackLeadRow,
  type TrackLinkRow,
} from './discover';
import { songKey, type EngineData } from './engine';
import type { StartTrack } from './radioStart';

type TrackRow = {
  id: number;
  title: string;
  artist: string;
  artistId: number;
  year: number | null;
  isMissing: 0 | 1;
  plays: number;
  skips: number;
  vector: Buffer | null;
};

export type Snapshot = {
  data: EngineData;
  /** The same tracks as `data`, with what radio can start from. */
  startTracks: readonly StartTrack[];
  ownedArtists: ReadonlySet<string>;
  /** The first track of each song that's there. */
  ownedSongs: ReadonlyMap<string, OwnedSong>;
  /** The id with the most tracks, when several spellings share a key. */
  ownedArtistIds: ReadonlyMap<string, number>;
  profiles: ReadonlyMap<string, ArtistProfile>;
  artistRows: ArtistLinkRow[];
  trackRows: TrackLinkRow[];
  fingerprintCount: number;
};

type LinkMap = Map<string, Map<string, number>>;

function addLink(links: LinkMap, from: string, to: string, score: number): void {
  const targets = links.get(from) ?? new Map<string, number>();
  targets.set(to, Math.max(targets.get(to) ?? 0, score));
  links.set(from, targets);
}

export function readSnapshot(dbPath: string): Snapshot {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: BUSY_TIMEOUT_MS });
  try {
    const rows = db
      .prepare<[string], TrackRow>(
        `SELECT t.id, t.title, a.name AS artist, t.artist_id AS artistId, t.year, f.missing_since IS NOT NULL AS isMissing,
           (SELECT COUNT(*) FROM play_events e WHERE e.track_id = t.id) AS plays,
           COALESCE((SELECT s.skips FROM track_skips s WHERE s.track_id = t.id), 0) AS skips,
           p.vector
         FROM tracks t
         JOIN artists a ON a.id = t.artist_id
         JOIN files f ON f.id = t.file_id
         LEFT JOIN fingerprints p
           ON p.audio_hash = f.audio_hash AND p.start_ms = t.start_ms AND p.end_ms = COALESCE(t.end_ms, -1) AND p.model = ?
         ORDER BY t.id`,
      )
      .all(FINGERPRINT_MODEL);
    const genres = new Map<number, number[]>();
    const mains = new Map<number, Set<string>>();
    for (const { trackId, genreId, name } of db
      .prepare<[], { trackId: number; genreId: number; name: string }>(
        `SELECT tg.track_id AS trackId, tg.genre_id AS genreId, g.name
         FROM track_genres tg JOIN genres g ON g.id = tg.genre_id`,
      )
      .all()) {
      const list = genres.get(trackId) ?? [];
      list.push(genreId);
      genres.set(trackId, list);
      const names = mains.get(trackId) ?? new Set<string>();
      names.add(mainGenreOf(name));
      mains.set(trackId, names);
    }

    const withVectors = rows.filter(
      ({ vector }) => vector !== null && vector.byteLength === EMBEDDING_SIZE * Float32Array.BYTES_PER_ELEMENT,
    ).length;
    const vectors = new Float32Array(withVectors * EMBEDDING_SIZE);
    let nextRow = 0;
    const tracks = rows.map(({ id, title, artist, artistId, year, isMissing, plays, skips, vector }): StartTrack => {
      let row = -1;
      if (vector !== null && vector.byteLength === EMBEDDING_SIZE * Float32Array.BYTES_PER_ELEMENT) {
        row = nextRow;
        nextRow += 1;
        vectors.set(
          new Float32Array(vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength)),
          row * EMBEDDING_SIZE,
        );
      }
      return {
        id,
        artistKey: artistKey(artist),
        titleKey: titleKey(title),
        genres: genres.get(id) ?? [],
        plays,
        skips,
        isMissing: isMissing === 1,
        vector: row,
        artistId,
        year,
        mains: [...(mains.get(id) ?? [])],
      };
    });

    const playable = tracks.filter(({ isMissing }) => !isMissing);
    const ownedArtists = new Set(playable.map((track) => track.artistKey));
    const ownedSongs = new Map<string, OwnedSong>();
    for (const { id, title, artist, artistId, isMissing } of rows) {
      const song = songKey(artistKey(artist), titleKey(title));
      if (isMissing === 0 && !ownedSongs.has(song)) ownedSongs.set(song, { trackId: id, artistId });
    }

    const artistRows = db
      .prepare<[], ArtistLinkRow>(
        `SELECT source_key AS sourceKey, source_name AS sourceName, target_key AS targetKey, target_name AS targetName, score
         FROM similar_artists`,
      )
      .all();
    const artistLinks: LinkMap = new Map();
    for (const { sourceKey, targetKey, score } of artistRows) {
      if (!ownedArtists.has(sourceKey) || !ownedArtists.has(targetKey)) continue;
      addLink(artistLinks, sourceKey, targetKey, score);
      addLink(artistLinks, targetKey, sourceKey, score);
    }

    const allTrackRows = db
      .prepare<[], TrackLinkRow & { sourceArtistKey: string; sourceTitleKey: string }>(
        `SELECT source_artist_key AS sourceArtistKey, source_title_key AS sourceTitleKey,
           target_artist_key AS targetArtistKey, target_title_key AS targetTitleKey, target_title AS targetTitle, score
         FROM similar_tracks`,
      )
      .all();
    const trackLinks: LinkMap = new Map();
    for (const { sourceArtistKey, sourceTitleKey, targetArtistKey, targetTitleKey, score } of allTrackRows) {
      const from = songKey(sourceArtistKey, sourceTitleKey);
      const to = songKey(targetArtistKey, targetTitleKey);
      if (!ownedSongs.has(from) || !ownedSongs.has(to)) continue;
      addLink(trackLinks, from, to, score);
      addLink(trackLinks, to, from, score);
    }

    const genreRows = db
      .prepare<[], { artist: string; genre: string; tracks: number }>(
        `SELECT a.name AS artist, g.name AS genre, COUNT(*) AS tracks
         FROM tracks t
         JOIN artists a ON a.id = t.artist_id
         JOIN files f ON f.id = t.file_id
         JOIN track_genres tg ON tg.track_id = t.id
         JOIN genres g ON g.id = tg.genre_id
         WHERE f.missing_since IS NULL
         GROUP BY t.artist_id, tg.genre_id`,
      )
      .all();
    const artRows = db
      .prepare<[], { artist: string; artHash: string }>(
        `SELECT a.name AS artist, al.art_hash AS artHash
         FROM tracks t
         JOIN artists a ON a.id = t.artist_id
         JOIN files f ON f.id = t.file_id
         JOIN albums al ON al.id = t.album_id
         WHERE f.missing_since IS NULL AND al.art_hash IS NOT NULL
         GROUP BY t.artist_id, al.id
         ORDER BY COUNT(*) DESC, al.id`,
      )
      .all();

    const ownedArtistIds = new Map<string, number>();
    for (const { id, name } of db
      .prepare<[], { id: number; name: string }>(
        `SELECT a.id, a.name
         FROM tracks t
         JOIN artists a ON a.id = t.artist_id
         JOIN files f ON f.id = t.file_id
         WHERE f.missing_since IS NULL
         GROUP BY a.id
         ORDER BY COUNT(*) DESC, a.id`,
      )
      .all()) {
      const key = artistKey(name);
      if (!ownedArtistIds.has(key)) ownedArtistIds.set(key, id);
    }

    return {
      data: { tracks, vectors, dimensions: EMBEDDING_SIZE, artistLinks, trackLinks, hubs: null },
      startTracks: tracks,
      ownedArtists,
      ownedSongs,
      ownedArtistIds,
      profiles: artistProfiles(
        genreRows.map(({ artist, genre, tracks: count }) => ({ artistKey: artistKey(artist), genre, tracks: count })),
        artRows.map(({ artist, artHash }) => ({ artistKey: artistKey(artist), artHash })),
      ),
      artistRows,
      trackRows: allTrackRows,
      fingerprintCount: withVectors,
    };
  } finally {
    db.close();
  }
}

/** Fresh each time: a snapshot isn't read again for a play. */
export function readLastPlayed(dbPath: string): Map<number, number> {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: BUSY_TIMEOUT_MS });
  try {
    const rows = db
      .prepare<[], { trackId: number; at: number }>(
        'SELECT track_id AS trackId, MAX(played_at) AS at FROM play_events GROUP BY track_id',
      )
      .all();
    return new Map(rows.map(({ trackId, at }) => [trackId, at]));
  } finally {
    db.close();
  }
}

/** Indexed, and asked for one artist at a time when someone opens it. */
export function readTrackLeads(dbPath: string, targetArtistKey: string): TrackLeadRow[] {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: BUSY_TIMEOUT_MS });
  try {
    return db
      .prepare<[string], TrackLeadRow>(
        `SELECT source_artist_key AS sourceArtistKey, source_title_key AS sourceTitleKey,
           source_artist AS sourceArtist, source_title AS sourceTitle,
           target_title_key AS targetTitleKey, target_title AS targetTitle, score
         FROM similar_tracks
         WHERE target_artist_key = ?`,
      )
      .all(targetArtistKey);
  } finally {
    db.close();
  }
}
