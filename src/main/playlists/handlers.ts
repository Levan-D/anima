import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname } from 'node:path';
import type { PlaylistDetail } from '@shared/domain';
import type { EventPayload } from '@shared/ipc/contract';
import type { EventName } from '@shared/ipc/channels';
import { err, ok, type Result } from '@shared/result';
import type { HandlerGroup } from '@main/ipc';
import type { Library } from '@main/library/library';
import { readM3u, writeM3u } from './m3u';
import { createPlaylistQueries, type PlaylistQueries } from './queries';

type Deps = {
  library: Pick<Library, 'perConnection' | 'read' | 'markChanged' | 'absolutePath' | 'findTrack'>;
  emit: <E extends EventName>(event: E, payload: EventPayload<E>) => void;
  now: () => number;
  /** Null when cancelled. */
  pickExportPath: (suggestedName: string) => Promise<string | null>;
  pickImportFile: () => Promise<string | null>;
};

const FILE_NAME_UNSAFE = /[<>:"/\\|?*]/g;

const notThere = () => err('not_found', "That playlist isn't there any more");
const nameTaken = (name: string) => err('name_taken', `There's already a playlist called ${name}`);

export function playlistHandlers({ library, emit, now, pickExportPath, pickImportFile }: Deps) {
  const playlists = library.perConnection(createPlaylistQueries);

  function writing<T>(work: (queries: PlaylistQueries) => Result<T>): Result<T> {
    const result = playlists(work);
    if (!result.ok) return result;
    if (result.value.ok) {
      library.markChanged();
      emit('library.changed', { scopes: ['playlists'] });
    }
    return result.value;
  }

  function writingTo<T>(playlistId: number, work: (queries: PlaylistQueries) => T): Result<T> {
    return writing((queries) => (queries.exists(playlistId) ? ok(work(queries)) : notThere()));
  }

  function detail(playlistId: number): Result<PlaylistDetail> {
    const stored = playlists((queries) => ({ summary: queries.summary(playlistId), rows: queries.items(playlistId) }));
    if (!stored.ok) return stored;
    const { summary, rows } = stored.value;
    if (summary === null) return notThere();

    const tracks = library.read((queries) => queries.tracksByIds(rows.map(({ trackId }) => trackId)));
    if (!tracks.ok) return tracks;
    const byId = new Map(tracks.value.map((track) => [track.id, track]));
    return ok({
      ...summary,
      // A copy for each: IPC keeps a shared object shared, and a list finds the row that was played by its identity.
      items: rows.flatMap(({ itemId, trackId }) => {
        const track = byId.get(trackId);
        return track === undefined ? [] : [{ itemId, track: { ...track } }];
      }),
    });
  }

  return {
    'playlist.list': () => playlists((queries) => queries.list()),
    'playlist.get': ({ playlistId }) => detail(playlistId),
    'playlist.create': ({ name, trackIds }) =>
      writing((queries) => {
        if (queries.idOfName(name) !== null) return nameTaken(name);
        const summary = queries.summary(queries.create(name, trackIds, now()));
        return summary === null ? notThere() : ok(summary);
      }),
    'playlist.rename': ({ playlistId, name }) =>
      writing((queries) => {
        if (!queries.exists(playlistId)) return notThere();
        const owner = queries.idOfName(name);
        if (owner !== null && owner !== playlistId) return nameTaken(name);
        queries.rename(playlistId, name, now());
        return ok();
      }),
    'playlist.save': ({ playlistId, name, trackIds }) =>
      writing((queries) => {
        if (!queries.exists(playlistId)) return notThere();
        const owner = queries.idOfName(name);
        if (owner !== null && owner !== playlistId) return nameTaken(name);
        queries.save(playlistId, name, trackIds, now());
        return ok();
      }),
    /** False if cancelled. A missing track is written too, where its file was, for a player that can reach it. */
    'playlist.export': async ({ playlistId }) => {
      const found = detail(playlistId);
      if (!found.ok) return found;
      const { name, items } = found.value;
      const path = await pickExportPath(`${name.replace(FILE_NAME_UNSAFE, '-')}.m3u8`);
      if (path === null) return ok(false);
      const tracks = items.flatMap(({ track }) => {
        const file = library.absolutePath(track.id);
        return file === null
          ? []
          : [{ path: file, seconds: track.durationMs / 1000, artist: track.artist, title: track.title }];
      });
      try {
        writeFileSync(path, writeM3u(name, tracks));
      } catch {
        return err('unexpected', "That file couldn't be written");
      }
      return ok(true);
    },
    /** Null if cancelled. Lines that aren't in this library are left out and counted. A taken name gets a number. */
    'playlist.import': async () => {
      const path = await pickImportFile();
      if (path === null) return ok(null);
      let text: string;
      try {
        text = readFileSync(path, 'utf8');
      } catch {
        return err('file_unreadable', "That file couldn't be read");
      }
      const { name, entries } = readM3u(text, dirname(path));
      const trackIds = entries.flatMap(({ path: line, artist, title }) => library.findTrack(line, artist, title) ?? []);
      const base = (name ?? basename(path, extname(path))).trim().slice(0, 190) || 'Imported';
      return writing((queries) => {
        let candidate = base;
        for (let n = 2; queries.idOfName(candidate) !== null; n++) candidate = `${base} (${n})`;
        const playlistId = queries.create(candidate, trackIds, now());
        return ok({ playlistId, name: candidate, matched: trackIds.length, total: entries.length });
      });
    },
    'playlist.delete': ({ playlistId }) =>
      writingTo(playlistId, (queries) => {
        queries.delete(playlistId);
      }),
    'playlist.addTracks': ({ playlistId, trackIds, index }) =>
      writingTo(playlistId, (queries) => ({ added: queries.addTracks(playlistId, trackIds, index, now()) })),
    'playlist.removeItems': ({ playlistId, itemIds }) =>
      writingTo(playlistId, (queries) => {
        queries.removeItems(playlistId, itemIds, now());
      }),
    'playlist.moveItems': ({ playlistId, itemIds, toIndex }) =>
      writingTo(playlistId, (queries) => queries.moveItems(playlistId, itemIds, toIndex, now())),
    'playlist.removeMissing': ({ playlistId }) =>
      writingTo(playlistId, (queries) => ({ removed: queries.removeMissing(playlistId, now()) })),
  } satisfies HandlerGroup;
}
