/* What a person says about a song's theme. Ids come in and name keys go in the table, so a mark outlasts the row it was on. */

import type { ThemeMark } from '@shared/themes';
import type { EventPayload } from '@shared/ipc/contract';
import type { EventName } from '@shared/ipc/channels';
import { ok, type Result } from '@shared/result';
import type { Connection } from '@main/db/connection';
import type { HandlerGroup } from '@main/ipc';
import type { Library } from '@main/library/library';
import { artistKey } from '@main/library/names';
import { albumMarkKey, trackMarkKey, type MarkKind } from './themes';

type NamedTrack = { title: string; artist: string };
type NamedAlbum = { title: string; artist: string };

function createQueries(db: Connection) {
  const upsert = db.prepare<[MarkKind, string, string]>(
    'INSERT INTO theme_marks (kind, key, theme) VALUES (?, ?, ?) ON CONFLICT (kind, key) DO UPDATE SET theme = excluded.theme',
  );
  const remove = db.prepare<[MarkKind, string]>('DELETE FROM theme_marks WHERE kind = ? AND key = ?');
  const track = db.prepare<[number], NamedTrack>(
    `SELECT t.title, a.name AS artist FROM tracks t JOIN artists a ON a.id = t.artist_id WHERE t.id = ?`,
  );
  const tracksOnAlbum = db.prepare<[number], NamedTrack>(
    `SELECT t.title, a.name AS artist FROM tracks t JOIN artists a ON a.id = t.artist_id WHERE t.album_id = ?`,
  );
  const album = db.prepare<[number], NamedAlbum>(
    `SELECT al.title, a.name AS artist FROM albums al JOIN artists a ON a.id = al.artist_id WHERE al.id = ?`,
  );
  const artist = db.prepare<[number], { name: string }>('SELECT name FROM artists WHERE id = ?');
  const tracksByArtist = db.prepare<[number], NamedTrack>(
    `SELECT t.title, a.name AS artist FROM tracks t JOIN artists a ON a.id = t.artist_id WHERE t.artist_id = ?`,
  );
  const albumsByArtist = db.prepare<[number], NamedAlbum>(
    `SELECT DISTINCT al.title, a.name AS artist
     FROM tracks t JOIN albums al ON al.id = t.album_id JOIN artists a ON a.id = al.artist_id
     WHERE t.artist_id = ?`,
  );

  function say(kind: MarkKind, key: string, mark: ThemeMark): void {
    if (mark === 'auto') remove.run(kind, key);
    else upsert.run(kind, key, mark);
  }
  const forgetTracks = (tracks: readonly NamedTrack[]) => {
    for (const { title, artist: name } of tracks) remove.run('track', trackMarkKey(title, name));
  };

  return {
    markTracks: db.transaction((trackIds: readonly number[], mark: ThemeMark) => {
      for (const id of trackIds) {
        const found = track.get(id);
        if (found !== undefined) say('track', trackMarkKey(found.title, found.artist), mark);
      }
    }),
    markAlbum: db.transaction((albumId: number, mark: ThemeMark) => {
      const found = album.get(albumId);
      if (found === undefined) return;
      forgetTracks(tracksOnAlbum.all(albumId));
      say('album', albumMarkKey(found.title, found.artist), mark);
    }),
    markArtist: db.transaction((artistId: number, mark: ThemeMark) => {
      const found = artist.get(artistId);
      if (found === undefined) return;
      forgetTracks(tracksByArtist.all(artistId));
      for (const { title, artist: name } of albumsByArtist.all(artistId)) remove.run('album', albumMarkKey(title, name));
      say('artist', artistKey(found.name), mark);
    }),
  };
}

type Deps = {
  library: Pick<Library, 'perConnection'>;
  emit: <E extends EventName>(event: E, payload: EventPayload<E>) => void;
  /** So the engine, what's waiting to play and what's previewed hear about it. */
  onMarked: () => void;
};

export function themeMarkHandlers({ library, emit, onMarked }: Deps) {
  const queries = library.perConnection(createQueries);

  function changed<T>(result: Result<T>): Result<void> {
    if (!result.ok) return result;
    onMarked();
    emit('library.changed', { scopes: ['recommendations'] });
    return ok();
  }

  return {
    'seasons.mark': ({ target, mark }) => {
      switch (target.kind) {
        case 'tracks':
          return changed(queries(({ markTracks }) => markTracks(target.trackIds, mark)));
        case 'album':
          return changed(queries(({ markAlbum }) => markAlbum(target.albumId, mark)));
        case 'artist':
          return changed(queries(({ markArtist }) => markArtist(target.artistId, mark)));
      }
    },
  } satisfies HandlerGroup;
}
