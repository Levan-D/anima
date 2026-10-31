/* The rollups on a real temporary database. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Connection } from '@main/db/connection';
import { closeTestDatabase, openTestDatabase, tempDir } from '@main/library/testFixtures';
import { createStatsQueries, withoutGaps } from '@main/stats/stats';

let db: Connection;
let queries: ReturnType<typeof createStatsQueries>;

function addTrack(id: number, artistId: number, albumId: number | null, durationMs: number, isMissing = false): void {
  db.prepare(
    `INSERT OR IGNORE INTO files (id, rel_path, size_bytes, mtime_ms, codec, is_lossless, duration_ms, missing_since, scanned_at)
     VALUES (?, ?, 1, 1, 'flac', ?, ?, ?, 1)`,
  ).run(id, `${id}.flac`, id % 2, durationMs, isMissing ? 1 : null);
  db.prepare(`INSERT INTO tracks (id, file_id, title, sort_title, artist_id, album_id) VALUES (?, ?, ?, ?, ?, ?)`).run(
    id,
    id,
    `Track ${id}`,
    `track ${id}`,
    artistId,
    albumId,
  );
}

beforeEach(() => {
  ({ db } = openTestDatabase(tempDir('stats')));
  queries = createStatsQueries(db);
  db.prepare(`INSERT INTO artists (id, name, sort_name) VALUES (1, 'Quiet', 'quiet'), (2, 'Loud', 'loud')`).run();
  db.prepare(`INSERT INTO albums (id, artist_id, title, sort_title) VALUES (1, 2, 'Big', 'big')`).run();
  addTrack(1, 1, null, 60_000);
  addTrack(2, 2, 1, 120_000);
  addTrack(3, 2, 1, 180_000);
  addTrack(4, 2, 1, 1_000, true);
});

afterEach(() => closeTestDatabase(db));

describe('the summary', () => {
  it('has nothing to say before anything has played, except about the library', () => {
    const summary = queries.summary();
    expect(summary).toMatchObject({ totalPlays: 0, totalListenedMs: 0, firstPlayAt: null });
    expect(summary.topTracks).toEqual([]);
    expect(summary.listenedByMonth).toEqual([]);
    expect(summary.library).toEqual({
      tracks: 3,
      albums: 1,
      artists: 2,
      totalDurationMs: 360_000,
      lossless: 2,
      lossy: 1,
    });
  });

  it('rolls plays up by track, album, artist and month', () => {
    const october = new Date(2026, 9, 15).getTime();
    const august = new Date(2026, 7, 15).getTime();
    queries.recordPlay(1, october, 40_000);
    queries.recordPlay(2, august, 100_000);
    queries.recordPlay(2, october, 100_000);
    queries.recordPlay(3, october, 10_000);

    const summary = queries.summary();
    expect(summary).toMatchObject({ totalPlays: 4, totalListenedMs: 250_000, firstPlayAt: august });
    expect(summary.topArtists.map(({ id, name, plays }) => [id, name, plays])).toEqual([
      [2, 'Loud', 3],
      [1, 'Quiet', 1],
    ]);
    expect(summary.topAlbums).toMatchObject([{ id: 1, name: 'Big', subtitle: 'Loud', plays: 3, listenedMs: 210_000 }]);
    expect(summary.topTracks[0]).toMatchObject({ id: 2, name: 'Track 2', subtitle: 'Loud', plays: 2 });
    expect(summary.listenedByMonth).toEqual([
      { month: '2026-08', listenedMs: 100_000 },
      { month: '2026-09', listenedMs: 0 },
      { month: '2026-10', listenedMs: 150_000 },
    ]);
  });

  it('writes the time as it grows, and refuses a track that has gone', () => {
    const id = queries.recordPlay(1, 1, 30_000);
    if (id === null) throw new Error('Not recorded');
    queries.saveListened(id, 90_000);
    expect(queries.summary().totalListenedMs).toBe(90_000);
    expect(queries.recordPlay(999, 1, 30_000)).toBeNull();
  });
});

describe('withoutGaps', () => {
  it('crosses a year and keeps the last twelve', () => {
    const filled = withoutGaps([
      { month: '2025-01', listenedMs: 1 },
      { month: '2026-03', listenedMs: 2 },
    ]);
    expect(filled).toHaveLength(12);
    expect(filled[0]?.month).toBe('2025-04');
    expect(filled.at(-1)).toEqual({ month: '2026-03', listenedMs: 2 });
  });
});
