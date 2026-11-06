/* The playlist tables. Tracks themselves are read through Library, like everything else that shows one. */

import { PLAYLIST_COVERS, type PlaylistCover, type PlaylistSummary } from '@shared/domain';
import type { Connection } from '@main/db/connection';

const SUMMARY = `
  SELECT p.id, p.name, p.updated_at AS updatedAt, COUNT(i.id) AS trackCount,
    COALESCE(SUM(f.missing_since IS NOT NULL), 0) AS missingCount,
    COALESCE(SUM(CASE WHEN f.missing_since IS NULL THEN COALESCE(t.end_ms, f.duration_ms) - t.start_ms END), 0) AS durationMs
  FROM playlists p
  LEFT JOIN playlist_items i ON i.playlist_id = p.id
  LEFT JOIN tracks t ON t.id = i.track_id
  LEFT JOIN files f ON f.id = t.file_id`;

const ART_SHARES = `
  SELECT i.playlist_id AS playlistId, f.art_hash AS artHash, COUNT(*) AS tracks
  FROM playlist_items i
  JOIN tracks t ON t.id = i.track_id
  JOIN files f ON f.id = t.file_id
  WHERE f.missing_since IS NULL AND f.art_hash IS NOT NULL`;

type SummaryRow = Omit<PlaylistSummary, 'covers'>;
export type ArtShareRow = { playlistId: number; artHash: string; tracks: number };

/** Each playlist's covers, the ones most of its tracks carry first. Tracks with no art have nothing to show. */
export function coversOf(rows: readonly ArtShareRow[]): Map<number, PlaylistCover[]> {
  const covers = new Map<number, PlaylistCover[]>();
  for (const { playlistId, artHash, tracks } of rows) {
    covers.set(playlistId, [...(covers.get(playlistId) ?? []), { artHash, tracks }]);
  }
  for (const [playlistId, list] of covers) {
    covers.set(
      playlistId,
      list.toSorted((a, b) => b.tracks - a.tracks || a.artHash.localeCompare(b.artHash)).slice(0, PLAYLIST_COVERS),
    );
  }
  return covers;
}

export type PlaylistItemRow = {
  itemId: number;
  trackId: number;
};

export type PlaylistQueries = ReturnType<typeof createPlaylistQueries>;

export function createPlaylistQueries(db: Connection) {
  const statements = {
    list: db.prepare<[], SummaryRow>(`${SUMMARY} GROUP BY p.id ORDER BY p.name COLLATE NOCASE, p.id`),
    summary: db.prepare<[number], SummaryRow>(`${SUMMARY} WHERE p.id = ? GROUP BY p.id`),
    allShares: db.prepare<[], ArtShareRow>(`${ART_SHARES} GROUP BY i.playlist_id, f.art_hash`),
    sharesOf: db.prepare<[number], ArtShareRow>(
      `${ART_SHARES} AND i.playlist_id = ? GROUP BY i.playlist_id, f.art_hash`,
    ),
    items: db.prepare<[number], PlaylistItemRow>(
      `SELECT id AS itemId, track_id AS trackId FROM playlist_items WHERE playlist_id = ? ORDER BY position, id`,
    ),
    idOfName: db.prepare<[string], { id: number }>('SELECT id FROM playlists WHERE name = ?'),
    exists: db.prepare<[number], { found: number }>('SELECT 1 AS found FROM playlists WHERE id = ?'),
    knownTracks: db.prepare<[string], { id: number }>(
      'SELECT value AS id FROM json_each(?) WHERE value IN (SELECT id FROM tracks) ORDER BY key',
    ),

    create: db.prepare<[string, number, number]>(
      'INSERT INTO playlists (name, created_at, updated_at) VALUES (?, ?, ?)',
    ),
    rename: db.prepare<[string, number]>('UPDATE playlists SET name = ? WHERE id = ?'),
    delete: db.prepare<[number]>('DELETE FROM playlists WHERE id = ?'),
    touch: db.prepare<[number, number]>('UPDATE playlists SET updated_at = ? WHERE id = ?'),

    insertItem: db.prepare<[number, number, number]>(
      'INSERT INTO playlist_items (playlist_id, track_id, position) VALUES (?, ?, ?)',
    ),
    makeRoom: db.prepare<[number, number, number]>(
      'UPDATE playlist_items SET position = position + ? WHERE playlist_id = ? AND position >= ?',
    ),
    deleteItem: db.prepare<[number, number]>('DELETE FROM playlist_items WHERE playlist_id = ? AND id = ?'),
    deleteMissingItems: db.prepare<[number]>(
      `DELETE FROM playlist_items WHERE playlist_id = ? AND track_id IN (
         SELECT t.id FROM tracks t JOIN files f ON f.id = t.file_id WHERE f.missing_since IS NOT NULL
       )`,
    ),
    setPosition: db.prepare<[number, number]>('UPDATE playlist_items SET position = ? WHERE id = ?'),
  };

  function itemsOf(playlistId: number): PlaylistItemRow[] {
    return statements.items.all(playlistId);
  }

  function writeOrder(order: readonly number[]): void {
    for (const [position, itemId] of order.entries()) statements.setPosition.run(position, itemId);
  }

  /** Positions stay 0, 1, 2… so an index from the UI and a position are the same thing. */
  function closeGaps(playlistId: number): void {
    writeOrder(itemsOf(playlistId).map(({ itemId }) => itemId));
  }

  /** A track goes in once. Returns how many actually went in. */
  function insertTracks(playlistId: number, trackIds: readonly number[], index: number | null): number {
    const items = itemsOf(playlistId);
    const present = new Set(items.map(({ trackId }) => trackId));
    const known = statements.knownTracks.all(JSON.stringify(trackIds)).map(({ id }) => id);
    const fresh = [...new Set(known)].filter((id) => !present.has(id));
    const start = index === null ? items.length : Math.min(index, items.length);
    statements.makeRoom.run(fresh.length, playlistId, start);
    for (const [offset, trackId] of fresh.entries()) statements.insertItem.run(playlistId, trackId, start + offset);
    return fresh.length;
  }

  // Immediate, because a scan can be writing on its own connection, and a read that turns into a write can't wait for it.
  const create = db.transaction((name: string, trackIds: readonly number[], now: number): number => {
    const playlistId = Number(statements.create.run(name, now, now).lastInsertRowid);
    insertTracks(playlistId, trackIds, null);
    return playlistId;
  });

  const addTracks = db.transaction(
    (playlistId: number, trackIds: readonly number[], index: number | null, now: number): number => {
      const added = insertTracks(playlistId, trackIds, index);
      statements.touch.run(now, playlistId);
      return added;
    },
  );

  /**
   * The editor's save, all or nothing: the name, and exactly these tracks in this order. An item that stays keeps its id,
   * a track in here twice keeps its first, and an id the library doesn't know is left out.
   */
  const save = db.transaction((playlistId: number, name: string, trackIds: readonly number[], now: number): void => {
    const known = new Set(statements.knownTracks.all(JSON.stringify(trackIds)).map(({ id }) => id));
    const wanted = [...new Set(trackIds.filter((trackId) => known.has(trackId)))];
    const isWanted = new Set(wanted);
    const kept = new Map<number, number>();
    for (const { itemId, trackId } of itemsOf(playlistId)) {
      if (isWanted.has(trackId) && !kept.has(trackId)) kept.set(trackId, itemId);
      else statements.deleteItem.run(playlistId, itemId);
    }
    const order = wanted.map(
      (trackId) =>
        kept.get(trackId) ?? Number(statements.insertItem.run(playlistId, trackId, wanted.length).lastInsertRowid),
    );
    writeOrder(order);
    statements.rename.run(name, playlistId);
    statements.touch.run(now, playlistId);
  });

  const removeMissing = db.transaction((playlistId: number, now: number): number => {
    const removed = statements.deleteMissingItems.run(playlistId).changes;
    closeGaps(playlistId);
    statements.touch.run(now, playlistId);
    return removed;
  });

  return {
    list(): PlaylistSummary[] {
      const covers = coversOf(statements.allShares.all());
      return statements.list.all().map((row) => ({ ...row, covers: covers.get(row.id) ?? [] }));
    },
    summary(playlistId: number): PlaylistSummary | null {
      const row = statements.summary.get(playlistId);
      if (row === undefined) return null;
      return { ...row, covers: coversOf(statements.sharesOf.all(playlistId)).get(playlistId) ?? [] };
    },
    items: itemsOf,
    exists: (playlistId: number) => statements.exists.get(playlistId) !== undefined,
    /** Names are unique whatever their case, which is what the column's collation does here. */
    idOfName: (name: string) => statements.idOfName.get(name)?.id ?? null,

    create: (name: string, trackIds: readonly number[], now: number) => create.immediate(name, trackIds, now),
    delete: (playlistId: number) => statements.delete.run(playlistId),
    addTracks: (playlistId: number, trackIds: readonly number[], index: number | null, now: number) =>
      addTracks.immediate(playlistId, trackIds, index, now),
    removeMissing: (playlistId: number, now: number) => removeMissing.immediate(playlistId, now),
    save: (playlistId: number, name: string, trackIds: readonly number[], now: number) =>
      save.immediate(playlistId, name, trackIds, now),
  };
}
