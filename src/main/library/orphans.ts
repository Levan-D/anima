import type { Connection } from '@main/db/connection';

/** Artists, albums, genres and art rows with no tracks left: the only things a scan ever deletes. */
export function createOrphanPruner(db: Connection) {
  const deletes = [
    'DELETE FROM albums WHERE NOT EXISTS (SELECT 1 FROM tracks t WHERE t.album_id = albums.id)',
    `DELETE FROM artists
     WHERE NOT EXISTS (SELECT 1 FROM tracks t WHERE t.artist_id = artists.id)
       AND NOT EXISTS (SELECT 1 FROM albums a WHERE a.artist_id = artists.id)`,
    'DELETE FROM genres WHERE NOT EXISTS (SELECT 1 FROM track_genres tg WHERE tg.genre_id = genres.id)',
    'DELETE FROM art WHERE NOT EXISTS (SELECT 1 FROM files f WHERE f.art_hash = art.hash)',
  ].map((sql) => db.prepare<[]>(sql));

  return (): void => {
    for (const statement of deletes) statement.run();
  };
}
