/*
 * A track's lyrics: what's stored, what's beside the file, what's in its tags and what LRCLIB says, in the order
 * `pickLyrics` wants them. Embedded and sidecar lyrics are read each time and never stored.
 */
import type { Lyrics, LyricsImportReport } from '@shared/domain';
import type { EventPayload } from '@shared/ipc/contract';
import type { EventName } from '@shared/ipc/channels';
import { err, ok, type Result } from '@shared/result';
import type { Connection } from '@main/db/connection';
import type { HandlerGroup } from '@main/ipc';
import type { Library } from '@main/library/library';
import { UNKNOWN_ARTIST } from '@main/library/tags';
import type { ImportJob } from './import';
import type { LrclibLyrics, LrclibTrack } from './lrclib';
import { parseStored, pickLyrics, readEmbedded, readSidecar, type PickedLyrics, type StoredLyrics } from './sources';

type TrackRow = {
  startMs: number;
  endMs: number | null;
  title: string;
  artist: string;
  album: string | null;
  fileDurationMs: number;
};

type Deps = {
  library: Pick<Library, 'perConnection' | 'markChanged' | 'absolutePath' | 'folder' | 'storedInfo'>;
  settings: { get(): { fetchLyricsOnline: boolean } };
  emit: <E extends EventName>(event: E, payload: EventPayload<E>) => void;
  log: { warn: (...details: unknown[]) => void };
  now: () => number;
  lrclib: { lookup: (track: LrclibTrack) => Promise<Result<LrclibLyrics>> };
  pickFile: () => Promise<string | null>;
  runImport: (job: ImportJob) => Promise<Result<LyricsImportReport>>;
  read?: { sidecar: typeof readSidecar; embedded: typeof readEmbedded };
};

function createLyricsQueries(db: Connection) {
  const track = db.prepare<[number], TrackRow>(`
    SELECT t.start_ms AS startMs, t.end_ms AS endMs, t.title, ar.name AS artist, al.title AS album,
           f.duration_ms AS fileDurationMs
    FROM tracks t
    JOIN files f ON f.id = t.file_id
    JOIN artists ar ON ar.id = t.artist_id
    LEFT JOIN albums al ON al.id = t.album_id
    WHERE t.id = ?
  `);
  const stored = db.prepare<[number], StoredLyrics>(
    'SELECT status, synced_lrc AS syncedLrc, plain_text AS plainText FROM lyrics WHERE track_id = ?',
  );
  const store = db.prepare<[number, StoredLyrics['status'], string | null, string | null, number]>(`
    INSERT INTO lyrics (track_id, status, synced_lrc, plain_text, fetched_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (track_id) DO UPDATE SET
      status = excluded.status,
      synced_lrc = excluded.synced_lrc,
      plain_text = excluded.plain_text,
      fetched_at = excluded.fetched_at
  `);
  const offset = db.prepare<[number], { offsetMs: number }>(
    'SELECT offset_ms AS offsetMs FROM lyrics_offsets WHERE track_id = ?',
  );
  const setOffset = db.prepare<[number, number, number]>(`
    INSERT INTO lyrics_offsets (track_id, offset_ms) SELECT id, ? FROM tracks WHERE id = ?
    ON CONFLICT (track_id) DO UPDATE SET offset_ms = ?
  `);
  const clearOffset = db.prepare<[number]>('DELETE FROM lyrics_offsets WHERE track_id = ?');

  return {
    track: (trackId: number) => track.get(trackId) ?? null,
    stored: (trackId: number) => stored.get(trackId) ?? null,
    store(trackId: number, row: StoredLyrics, now: number): void {
      store.run(trackId, row.status, row.syncedLrc, row.plainText, now);
    },
    offset: (trackId: number) => offset.get(trackId)?.offsetMs ?? 0,
    setOffset(trackId: number, offsetMs: number): void {
      setOffset.run(offsetMs, trackId, offsetMs);
    },
    clearOffset(trackId: number): void {
      clearOffset.run(trackId);
    },
  };
}

function storedFrom(answer: LrclibLyrics): StoredLyrics {
  if (answer.status !== 'found') return { status: answer.status, syncedLrc: null, plainText: null };
  return { status: 'found', syncedLrc: answer.syncedLrc, plainText: answer.plainText };
}

function lrclibTrack(row: TrackRow): LrclibTrack {
  return {
    title: row.title,
    artist: row.artist,
    album: row.album,
    durationMs: (row.endMs ?? row.fileDurationMs) - row.startMs,
  };
}

export function createLyrics(deps: Deps) {
  const { library, settings, emit, log, now, lrclib, pickFile, runImport } = deps;
  const read = deps.read ?? { sidecar: readSidecar, embedded: readEmbedded };
  const queries = library.perConnection(createLyricsQueries);
  const lookups = new Map<number, Promise<Result<void>>>();
  let isImporting = false;

  function announce(): void {
    library.markChanged();
    emit('library.changed', { scopes: ['lyrics'] });
  }

  function saveAnswer(trackId: number, answer: LrclibLyrics, isRefresh: boolean): Result<void> {
    const saved = queries((stored) => {
      // Asking again can only add to what's known: no answer doesn't take away lyrics that were being shown.
      if (stored.stored(trackId)?.status === 'found' && answer.status !== 'found') return;
      stored.store(trackId, storedFrom(answer), now());
      if (isRefresh && answer.status === 'found') stored.clearOffset(trackId);
    });
    if (saved.ok) announce();
    return saved;
  }

  async function lookUp(trackId: number, row: TrackRow, isRefresh: boolean): Promise<Result<void>> {
    const folder = library.folder();
    const answer = await lrclib.lookup(lrclibTrack(row));
    if (!answer.ok) {
      log.warn('Could not ask LRCLIB', answer.error.message);
      return answer;
    }
    // Ids mean nothing once a different library is open.
    return library.folder() === folder ? saveAnswer(trackId, answer.value, isRefresh) : ok();
  }

  /** Playing, opening and refreshing the same track while LRCLIB thinks all wait for the one answer. */
  function lookUpOnce(trackId: number, row: TrackRow, isRefresh: boolean): Promise<Result<void>> {
    const running = lookups.get(trackId);
    if (running) return running;
    const lookup = lookUp(trackId, row, isRefresh).finally(() => lookups.delete(trackId));
    lookups.set(trackId, lookup);
    return lookup;
  }

  function withOffset(trackId: number, picked: PickedLyrics): Result<Lyrics> {
    if (picked.status !== 'found') return ok(picked);
    const offsetMs = queries((stored) => stored.offset(trackId));
    return offsetMs.ok ? ok({ ...picked, offsetMs: offsetMs.value }) : offsetMs;
  }

  async function lyricsOf(trackId: number, isRefresh: boolean): Promise<Result<Lyrics>> {
    const row = queries((stored) => stored.track(trackId));
    if (!row.ok) return row;
    if (row.value === null) return err('not_found', "That track isn't in the library");
    const track = row.value;

    // A file's sidecar and tags speak for the whole file, and so for no one track of a CUE album.
    const path = track.startMs === 0 && track.endMs === null ? library.absolutePath(trackId) : null;
    const sidecar = path === null ? null : await read.sidecar(path);
    if (sidecar?.synced)
      return withOffset(trackId, pickLyrics({ sidecar, stored: null, embedded: null, lookupFailed: false }));

    const before = queries((stored) => stored.stored(trackId));
    if (!before.ok) return before;
    const canAsk = settings.get().fetchLyricsOnline && track.artist !== UNKNOWN_ARTIST;
    const lookup = canAsk && (before.value === null || isRefresh) ? await lookUpOnce(trackId, track, isRefresh) : ok();

    const stored = queries((all) => all.stored(trackId));
    if (!stored.ok) return stored;
    const hasTimed = parseStored(stored.value)?.synced != null;
    const embedded = path === null || hasTimed ? null : await read.embedded(path);
    return withOffset(trackId, pickLyrics({ sidecar, stored: stored.value, embedded, lookupFailed: !lookup.ok }));
  }

  async function importLibrary(): Promise<Result<LyricsImportReport | null>> {
    const dbPath = library.storedInfo().databasePath;
    if (dbPath === null) return err('no_library', "The library isn't open");
    if (isImporting) return ok(null);
    isImporting = true;
    try {
      const sourcePath = await pickFile();
      if (sourcePath === null) return ok(null);
      const report = await runImport({ sourcePath, dbPath });
      if (report.ok && report.value.added > 0) announce();
      return report;
    } finally {
      isImporting = false;
    }
  }

  return {
    get: (trackId: number) => lyricsOf(trackId, false),
    /** Ignores a remembered answer and asks again. New lyrics mean new timing, so a nudge for the old goes. */
    refresh: (trackId: number) => lyricsOf(trackId, true),
    setOffset(trackId: number, offsetMs: number): Result<void> {
      const written = queries((stored) => {
        if (offsetMs === 0) stored.clearOffset(trackId);
        else stored.setOffset(trackId, offsetMs);
      });
      if (written.ok) announce();
      return written;
    },
    importLibrary,
  };
}

export function lyricsHandlers(lyrics: ReturnType<typeof createLyrics>) {
  return {
    'lyrics.get': ({ trackId }) => lyrics.get(trackId),
    'lyrics.refresh': ({ trackId }) => lyrics.refresh(trackId),
    'lyrics.setOffset': ({ trackId, offsetMs }) => lyrics.setOffset(trackId, offsetMs),
    'lyrics.importLibrary': () => lyrics.importLibrary(),
  } satisfies HandlerGroup;
}
