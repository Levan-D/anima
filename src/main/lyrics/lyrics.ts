/*
 * A track's lyrics: the person's own pick if there is one, or else what's stored, what's beside the file, what's in its
 * tags and what LRCLIB says, in the order `pickLyrics` wants them. Embedded and sidecar lyrics are read each time and
 * never stored.
 */
import type { Lyrics, LyricsImportReport, LyricsSearchHit } from '@shared/domain';
import type { EventPayload } from '@shared/ipc/contract';
import type { EventName } from '@shared/ipc/channels';
import { err, ok, type Result } from '@shared/result';
import type { Dataset, DatasetProgress } from '@main/datasets/datasets';
import type { Connection } from '@main/db/connection';
import type { HandlerGroup } from '@main/ipc';
import type { Library } from '@main/library/library';
import { UNKNOWN_ARTIST } from '@main/library/tags';
import type { ImportJob } from './import';
import type { LrclibLyrics, LrclibRecord, LrclibTrack } from './lrclib';
import {
  parseStored,
  pickChosen,
  pickLyrics,
  readEmbedded,
  readLyricsFile,
  readSidecar,
  sidecarPath,
  type LyricsOrigin,
  type PickedLyrics,
  type StoredLyrics,
  type StoredRow,
} from './sources';

const CANT_ASK = "LRCLIB can't be reached right now";
const GIVE_UP_AFTER_FAILURES_IN_A_ROW = 3;

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
  lrclib: {
    lookup: (track: LrclibTrack) => Promise<Result<LrclibLyrics>>;
    search: (query: string) => Promise<Result<LrclibRecord[]>>;
    record: (id: number) => Promise<Result<LrclibRecord | null>>;
  };
  pickFile: () => Promise<string | null>;
  pickLyricsFile: () => Promise<string | null>;
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
  const stored = db.prepare<[number], StoredRow>(
    'SELECT status, synced_lrc AS syncedLrc, plain_text AS plainText, origin FROM lyrics WHERE track_id = ?',
  );
  const store = db.prepare<[number, StoredLyrics['status'], string | null, string | null, LyricsOrigin, number]>(`
    INSERT INTO lyrics (track_id, status, synced_lrc, plain_text, origin, fetched_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (track_id) DO UPDATE SET
      status = excluded.status,
      synced_lrc = excluded.synced_lrc,
      plain_text = excluded.plain_text,
      origin = excluded.origin,
      fetched_at = excluded.fetched_at
  `);
  const clear = db.prepare<[number]>('DELETE FROM lyrics WHERE track_id = ?');
  const offset = db.prepare<[number], { offsetMs: number }>(
    'SELECT offset_ms AS offsetMs FROM lyrics_offsets WHERE track_id = ?',
  );
  const setOffset = db.prepare<[number, number, number]>(`
    INSERT INTO lyrics_offsets (track_id, offset_ms) SELECT id, ? FROM tracks WHERE id = ?
    ON CONFLICT (track_id) DO UPDATE SET offset_ms = ?
  `);
  const clearOffset = db.prepare<[number]>('DELETE FROM lyrics_offsets WHERE track_id = ?');
  const WANTED = `
    FROM tracks t
    JOIN files f ON f.id = t.file_id
    JOIN artists ar ON ar.id = t.artist_id
    LEFT JOIN lyrics l ON l.track_id = t.id
    WHERE f.missing_since IS NULL AND ar.name <> ?
  `;
  const unasked = db.prepare<[string], { id: number }>(`SELECT t.id ${WANTED} AND l.track_id IS NULL ORDER BY t.id`);
  const counts = db.prepare<[string], { total: number; done: number | null }>(
    `SELECT COUNT(*) AS total, SUM(l.track_id IS NOT NULL) AS done ${WANTED}`,
  );

  return {
    track: (trackId: number) => track.get(trackId) ?? null,
    stored: (trackId: number) => stored.get(trackId) ?? null,
    store(trackId: number, row: StoredLyrics, origin: LyricsOrigin, now: number): void {
      store.run(trackId, row.status, row.syncedLrc, row.plainText, origin, now);
    },
    clear(trackId: number): void {
      clear.run(trackId);
    },
    offset: (trackId: number) => offset.get(trackId)?.offsetMs ?? 0,
    setOffset(trackId: number, offsetMs: number): void {
      setOffset.run(offsetMs, trackId, offsetMs);
    },
    clearOffset(trackId: number): void {
      clearOffset.run(trackId);
    },
    unasked: () => unasked.all(UNKNOWN_ARTIST).map(({ id }) => id),
    counts: () => counts.get(UNKNOWN_ARTIST) ?? { total: 0, done: 0 },
  };
}

function storedFrom(answer: LrclibLyrics): StoredLyrics {
  if (answer.status !== 'found') return { status: answer.status, syncedLrc: null, plainText: null };
  return { status: 'found', syncedLrc: answer.syncedLrc, plainText: answer.plainText };
}

function filled(text: string | null): string | null {
  return text === null || text.trim() === '' ? null : text;
}

function storedFromRecord({ instrumental, syncedLyrics, plainLyrics }: LrclibRecord): StoredLyrics | null {
  const syncedLrc = filled(syncedLyrics);
  const plainText = filled(plainLyrics);
  if (syncedLrc !== null || plainText !== null) return { status: 'found', syncedLrc, plainText };
  return instrumental ? { status: 'instrumental', syncedLrc: null, plainText: null } : null;
}

function hitFrom(record: LrclibRecord): LyricsSearchHit[] {
  const row = storedFromRecord(record);
  if (row === null) return [];
  const plainOrInstrumental = row.status === 'instrumental' ? 'instrumental' : 'plain';
  return [
    {
      id: record.id,
      title: record.trackName,
      artist: record.artistName,
      album: filled(record.albumName),
      durationMs: Math.round(record.duration * 1000),
      kind: row.syncedLrc === null ? plainOrInstrumental : 'synced',
    },
  ];
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
  const { library, settings, emit, log, now, lrclib, pickFile, pickLyricsFile, runImport } = deps;
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
      const before = stored.stored(trackId);
      // Only the person replaces their own pick, and a lookup can finish after they've made it.
      if (!isRefresh && before !== null && before.origin !== 'lookup') return;
      // Asking again can only add to what's known: no answer doesn't take away lyrics that were being shown.
      if (before?.status === 'found' && answer.status !== 'found') return;
      stored.store(trackId, storedFrom(answer), 'lookup', now());
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

  /** A file's sidecar and tags speak for the whole file, and so for no one track of a CUE album. */
  function wholeFilePath(trackId: number, track: TrackRow): string | null {
    return track.startMs === 0 && track.endMs === null ? library.absolutePath(trackId) : null;
  }

  async function lyricsOf(trackId: number, isRefresh: boolean): Promise<Result<Lyrics>> {
    const row = queries((stored) => stored.track(trackId));
    if (!row.ok) return row;
    if (row.value === null) return err('not_found', "That track isn't in the library");
    const track = row.value;

    const before = queries((stored) => stored.stored(trackId));
    if (!before.ok) return before;
    const chosenBefore = isRefresh ? null : pickChosen(before.value);
    if (chosenBefore !== null) return withOffset(trackId, chosenBefore);

    const path = wholeFilePath(trackId, track);
    const sidecar = path === null ? null : await read.sidecar(path);
    if (sidecar?.synced)
      return withOffset(trackId, pickLyrics({ sidecar, stored: null, embedded: null, lookupFailed: false }));

    const canAsk = settings.get().fetchLyricsOnline && track.artist !== UNKNOWN_ARTIST;
    const needsAnswer = canAsk && (before.value === null || isRefresh);

    // A lookup can take a minute when offline, so what's on the disk doesn't wait for it. A better answer comes through
    // `library.changed`.
    if (needsAnswer && !isRefresh) {
      const embedded = path === null ? null : await read.embedded(path);
      const onDisk = pickLyrics({ sidecar, stored: null, embedded, lookupFailed: false });
      if (onDisk.status === 'found') {
        lookUpOnce(trackId, track, false).catch((error: unknown) => log.warn('Could not save the answer', error));
        return withOffset(trackId, onDisk);
      }
    }
    const lookup = needsAnswer ? await lookUpOnce(trackId, track, isRefresh) : ok();

    const stored = queries((all) => all.stored(trackId));
    if (!stored.ok) return stored;
    const chosen = pickChosen(stored.value);
    if (chosen !== null) return withOffset(trackId, chosen);
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

  /** New lyrics mean new timing, so a nudge for the old goes. */
  function saveOwn(trackId: number, row: StoredLyrics, origin: LyricsOrigin): Result<void> {
    const track = queries((stored) => stored.track(trackId));
    if (!track.ok) return track;
    if (track.value === null) return err('not_found', "That track isn't in the library");
    const saved = queries((stored) => {
      stored.store(trackId, row, origin, now());
      stored.clearOffset(trackId);
    });
    if (saved.ok) announce();
    return saved;
  }

  async function search(query: string): Promise<Result<LyricsSearchHit[]>> {
    const records = await lrclib.search(query);
    if (records.ok) return ok(records.value.flatMap(hitFrom));
    log.warn('Could not search LRCLIB', records.error.message);
    return err(records.error.code, CANT_ASK);
  }

  async function choose(trackId: number, recordId: number): Promise<Result<void>> {
    const folder = library.folder();
    const record = await lrclib.record(recordId);
    if (!record.ok) {
      log.warn('Could not get a record from LRCLIB', record.error.message);
      return err(record.error.code, CANT_ASK);
    }
    const row = record.value === null ? null : storedFromRecord(record.value);
    if (row === null) return err('not_found', 'LRCLIB no longer has those lyrics');
    return library.folder() === folder ? saveOwn(trackId, row, 'search') : ok();
  }

  async function loadFile(trackId: number): Promise<Result<boolean>> {
    const path = await pickLyricsFile();
    if (path === null) return ok(false);
    const row = await readLyricsFile(path);
    if (!row.ok) return row;
    const saved = saveOwn(trackId, row.value, 'file');
    return saved.ok ? ok(true) : saved;
  }

  /** Asked for, so it goes ahead whatever the switch says. One at a time, since a track's lookup already goes at LRCLIB's pace. */
  async function lookUpMissing(
    onProgress: (progress: DatasetProgress) => void,
    isCancelled: () => boolean,
  ): Promise<{ note: string | null }> {
    const ids = queries((stored) => stored.unasked());
    if (!ids.ok) return { note: ids.error.message };
    const folder = library.folder();
    let done = 0;
    let failed = 0;
    let failuresInARow = 0;
    onProgress({ done, failed, total: ids.value.length });
    for (const trackId of ids.value) {
      if (isCancelled() || library.folder() !== folder) break;
      const row = queries((stored) => stored.track(trackId));
      if (row.ok && row.value !== null) {
        const looked = await lookUpOnce(trackId, row.value, false);
        if (looked.ok) {
          done += 1;
          failuresInARow = 0;
        } else {
          failed += 1;
          failuresInARow += 1;
          if (failuresInARow === GIVE_UP_AFTER_FAILURES_IN_A_ROW) {
            return { note: `Stopped: ${CANT_ASK}. Update picks up from here.` };
          }
        }
      }
      onProgress({ done, failed, total: ids.value.length });
    }
    const words = `${failed.toLocaleString('en')} couldn't be looked up, and will be tried next time`;
    return { note: failed > 0 ? words : null };
  }

  const dataset: Dataset = {
    counts() {
      const counted = queries((stored) => stored.counts());
      if (!counted.ok) return counted;
      const done = counted.value.done ?? 0;
      return ok({ done, missing: counted.value.total - done, detail: null });
    },
    problem: () => null,
    start(_options, onProgress) {
      let cancelled = false;
      return ok({
        cancel: () => {
          cancelled = true;
        },
        finished: lookUpMissing(onProgress, () => cancelled),
      });
    },
  };

  return {
    dataset,
    get: (trackId: number) => lyricsOf(trackId, false),
    /** Ignores a remembered answer and asks again. New lyrics mean new timing, so a nudge for the old goes. */
    refresh: (trackId: number) => lyricsOf(trackId, true),
    search,
    choose,
    loadFile,
    clear(trackId: number): Result<void> {
      const cleared = queries((stored) => {
        stored.clear(trackId);
        stored.clearOffset(trackId);
      });
      if (cleared.ok) announce();
      return cleared;
    },
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
    'lyrics.search': ({ query }) => lyrics.search(query),
    'lyrics.choose': ({ trackId, recordId }) => lyrics.choose(trackId, recordId),
    'lyrics.loadFile': ({ trackId }) => lyrics.loadFile(trackId),
    'lyrics.clear': ({ trackId }) => lyrics.clear(trackId),
  } satisfies HandlerGroup;
}
