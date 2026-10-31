/* The listening log and what's rolled up from it. Plain SQL over play_events, read when the screen asks. */

import type { StatEntry, StatsSummary } from '@shared/domain';
import type { EventPayload } from '@shared/ipc/contract';
import type { EventName } from '@shared/ipc/channels';
import { ok, type Result } from '@shared/result';
import type { Connection } from '@main/db/connection';
import type { HandlerGroup } from '@main/ipc';
import type { Library } from '@main/library/library';
import { createListenLog } from './listenLog';

const TOP = 10;
const MONTHS = 12;

const PLAYS_AND_TIME = 'COUNT(*) AS plays, SUM(e.listened_ms) AS listenedMs';
const TOP_ORDER = `ORDER BY plays DESC, listenedMs DESC LIMIT ${TOP}`;

type MonthRow = { month: string; listenedMs: number };

export function createStatsQueries(db: Connection) {
  const insert = db.prepare<[number, number, number]>(
    // Through tracks, because the track can have been removed while it played.
    'INSERT INTO play_events (track_id, played_at, listened_ms) SELECT id, ?, ? FROM tracks WHERE id = ?',
  );
  const update = db.prepare<[number, number]>('UPDATE play_events SET listened_ms = ? WHERE id = ?');

  const totals = db.prepare<[], Pick<StatsSummary, 'totalPlays' | 'totalListenedMs' | 'firstPlayAt'>>(
    `SELECT COUNT(*) AS totalPlays, COALESCE(SUM(listened_ms), 0) AS totalListenedMs, MIN(played_at) AS firstPlayAt
     FROM play_events`,
  );
  const topArtists = db.prepare<[], StatEntry>(
    `WITH top AS (
       SELECT t.artist_id AS id, ${PLAYS_AND_TIME}
       FROM play_events e JOIN tracks t ON t.id = e.track_id
       GROUP BY t.artist_id ${TOP_ORDER}
     )
     SELECT top.id, ar.name, NULL AS subtitle, top.plays, top.listenedMs,
       COALESCE(
         (SELECT a.art_hash FROM albums a
          WHERE a.artist_id = top.id AND a.art_hash IS NOT NULL ORDER BY a.year, a.sort_title LIMIT 1),
         (SELECT f.art_hash FROM tracks t JOIN files f ON f.id = t.file_id
          WHERE t.artist_id = top.id AND f.art_hash IS NOT NULL LIMIT 1)
       ) AS artHash
     FROM top JOIN artists ar ON ar.id = top.id
     ORDER BY top.plays DESC, top.listenedMs DESC`,
  );
  const topAlbums = db.prepare<[], StatEntry>(
    `SELECT al.id, al.title AS name, ar.name AS subtitle, al.art_hash AS artHash, ${PLAYS_AND_TIME}
     FROM play_events e
     JOIN tracks t ON t.id = e.track_id
     JOIN albums al ON al.id = t.album_id
     JOIN artists ar ON ar.id = al.artist_id
     GROUP BY al.id ${TOP_ORDER}`,
  );
  const topTracks = db.prepare<[], StatEntry>(
    `SELECT t.id, t.title AS name, ar.name AS subtitle, f.art_hash AS artHash, ${PLAYS_AND_TIME}
     FROM play_events e
     JOIN tracks t ON t.id = e.track_id
     JOIN files f ON f.id = t.file_id
     JOIN artists ar ON ar.id = t.artist_id
     GROUP BY t.id ${TOP_ORDER}`,
  );
  const months = db.prepare<[], MonthRow>(
    `SELECT strftime('%Y-%m', played_at / 1000, 'unixepoch', 'localtime') AS month, SUM(listened_ms) AS listenedMs
     FROM play_events GROUP BY month ORDER BY month DESC LIMIT ${MONTHS}`,
  );
  const library = db.prepare<[], StatsSummary['library']>(
    `SELECT COUNT(*) AS tracks, COUNT(DISTINCT t.album_id) AS albums, COUNT(DISTINCT t.artist_id) AS artists,
       COALESCE(SUM(COALESCE(t.end_ms, f.duration_ms) - t.start_ms), 0) AS totalDurationMs,
       COALESCE(SUM(f.is_lossless), 0) AS lossless, COALESCE(SUM(1 - f.is_lossless), 0) AS lossy
     FROM tracks t JOIN files f ON f.id = t.file_id
     WHERE f.missing_since IS NULL`,
  );

  return {
    recordPlay(trackId: number, playedAt: number, listenedMs: number): number | null {
      const { changes, lastInsertRowid } = insert.run(playedAt, listenedMs, trackId);
      return changes > 0 ? Number(lastInsertRowid) : null;
    },
    saveListened(eventId: number, listenedMs: number): void {
      update.run(listenedMs, eventId);
    },
    summary(): StatsSummary {
      const none = { totalPlays: 0, totalListenedMs: 0, firstPlayAt: null };
      const emptyLibrary = { tracks: 0, albums: 0, artists: 0, totalDurationMs: 0, lossless: 0, lossy: 0 };
      return {
        ...(totals.get() ?? none),
        topArtists: topArtists.all(),
        topAlbums: topAlbums.all(),
        topTracks: topTracks.all(),
        listenedByMonth: withoutGaps(months.all().toReversed()),
        library: library.get() ?? emptyLibrary,
      };
    },
  };
}

function nextMonth(month: string): string {
  const [year = 0, number = 1] = month.split('-').map(Number);
  return number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, '0')}`;
}

/** A month with nothing played is a bar of nothing: leaving it out would make the time between two months look shorter. */
export function withoutGaps(rows: MonthRow[]): MonthRow[] {
  const filled: MonthRow[] = [];
  for (const row of rows) {
    const last = filled.at(-1);
    for (
      let month = last && nextMonth(last.month);
      month !== undefined && month < row.month;
      month = nextMonth(month)
    ) {
      filled.push({ month, listenedMs: 0 });
    }
    filled.push(row);
  }
  return filled.slice(-MONTHS);
}

type Deps = {
  library: Pick<Library, 'perConnection' | 'markChanged' | 'folder'>;
  emit: <E extends EventName>(event: E, payload: EventPayload<E>) => void;
  now: () => number;
  log: { warn: (...details: unknown[]) => void };
};

export type Stats = ReturnType<typeof createStats>;

export function createStats({ library, emit, now, log }: Deps) {
  const queries = library.perConnection(createStatsQueries);
  // Event ids only mean something in the library they were written to.
  let folderOfListen: string | null = null;

  /** Counting plays never gets to stop the music. */
  function writing<T>(work: () => T, fallback: T): T {
    try {
      return work();
    } catch (error) {
      log.warn('Could not write to the listening log', error);
      return fallback;
    }
  }

  const listening = createListenLog({
    recordPlay: (trackId, listenedMs) =>
      writing(() => {
        const written = queries((stored) => stored.recordPlay(trackId, now(), listenedMs));
        if (!written.ok || written.value === null) return null;
        folderOfListen = library.folder();
        library.markChanged();
        emit('library.changed', { scopes: ['stats'] });
        return written.value;
      }, null),
    saveListened(eventId, listenedMs) {
      if (folderOfListen !== library.folder()) return;
      writing(() => queries((stored) => stored.saveListened(eventId, listenedMs)), null);
    },
  });

  return {
    listening,
    summary: (): Result<StatsSummary> => {
      const summary = queries((stored) => stored.summary());
      return summary.ok ? ok(summary.value) : summary;
    },
  };
}

export function statsHandlers(stats: Stats) {
  return {
    'stats.summary': () => stats.summary(),
  } satisfies HandlerGroup;
}
