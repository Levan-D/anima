import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ok } from '@shared/result';
import type { CommandName } from '@shared/ipc/channels';
import type { CommandInput, CommandResult } from '@shared/ipc/contract';
import type { Connection } from '@main/db/connection';
import { createQueries } from '@main/library/queries';
import { createScanWriter, type ReadFile } from '@main/library/scanWriter';
import { closeTestDatabase, openTestDatabase, tempDir } from '@main/library/testFixtures';
import { playlistHandlers } from './handlers';
import { coversOf, createPlaylistQueries, type PlaylistQueries } from './queries';

let db: Connection;
let queries: PlaylistQueries;

function file(title: string, art: string | null = null): ReadFile {
  const relPath = `${title}.flac`;
  return {
    id: null,
    found: { relPath, sizeBytes: 1, mtimeMs: 1 },
    audioHash: `hash-${relPath}`,
    tags: {
      title,
      titleIsFileName: false,
      artist: 'Someone',
      albumArtist: 'Someone',
      album: null,
      year: null,
      discNumber: null,
      trackNumber: null,
      genres: [],
    },
    format: { codec: 'FLAC', isLossless: true, sampleRate: 44100, bitDepth: 16, channels: 2, durationMs: 1000 },
    facts: { hasReplayGain: true, hasAlbumArtist: true, hasGaplessHeader: null },
    art: art === null ? null : { hash: art, kind: 'embedded', relPath, mime: 'image/jpeg' },
    keepArt: false,
    cue: null,
  };
}

function trackId(title: string): number {
  const row = db.prepare<[string], { id: number }>('SELECT id FROM tracks WHERE title = ?').get(title);
  if (!row) throw new Error(`No track called ${title}`);
  return row.id;
}

function markMissing(title: string): void {
  db.prepare('UPDATE files SET missing_since = 1 WHERE rel_path = ?').run(`${title}.flac`);
}

function titlesIn(playlistId: number): string[] {
  const titleOf = db.prepare<[number], { title: string }>('SELECT title FROM tracks WHERE id = ?');
  return queries.items(playlistId).map(({ trackId: id }) => titleOf.get(id)?.title ?? '?');
}

function positionsIn(playlistId: number): number[] {
  return db
    .prepare<[number], { position: number }>(
      'SELECT position FROM playlist_items WHERE playlist_id = ? ORDER BY position',
    )
    .all(playlistId)
    .map(({ position }) => position);
}

function playlistOf(...titles: string[]): number {
  return queries.create('Mix', titles.map(trackId), 1);
}

function itemIds(playlistId: number, ...positions: number[]): number[] {
  const items = queries.items(playlistId);
  return positions.map((position) => items[position]?.itemId ?? 0);
}

beforeEach(() => {
  const opened = openTestDatabase(tempDir('playlists'));
  db = opened.db;
  queries = createPlaylistQueries(db);
  createScanWriter(db, { now: () => 1, hostname: 'test' }).commit([
    file('A', 'a'.repeat(40)),
    file('B', 'b'.repeat(40)),
    file('C'),
    file('D'),
    file('Café'),
  ]);
});

afterEach(() => closeTestDatabase(db));

describe('the queries', () => {
  it('a track goes in once, and adding says how many really went in', () => {
    const id = playlistOf('A', 'B', 'A');
    expect(titlesIn(id)).toEqual(['A', 'B']);
    expect(queries.summary(id)?.trackCount).toBe(2);
    expect(queries.addTracks(id, [trackId('A'), trackId('C'), trackId('C')], null, 2)).toBe(1);
    expect(queries.addTracks(id, [trackId('A')], null, 3)).toBe(0);
    expect(titlesIn(id)).toEqual(['A', 'B', 'C']);
  });

  it('a playlist from before that rule keeps its duplicate, each one its own item', () => {
    const id = playlistOf('A', 'B');
    db.prepare('INSERT INTO playlist_items (playlist_id, track_id, position) VALUES (?, ?, 2)').run(id, trackId('A'));
    const [first, , second] = itemIds(id, 0, 1, 2);
    expect(titlesIn(id)).toEqual(['A', 'B', 'A']);
    expect(queries.summary(id)?.trackCount).toBe(3);

    // Saved from the editor, which only ever has it once, the first one stays.
    queries.save(id, 'Mix', [trackId('A'), trackId('B')], 2);
    expect(titlesIn(id)).toEqual(['A', 'B']);
    expect(queries.items(id)[0]?.itemId).toBe(first);
    expect(itemIds(id, 0, 1)).not.toContain(second);
    expect(queries.addTracks(id, [trackId('A')], null, 3)).toBe(0);
  });

  it('adds to the end, or at an index, and closes up nothing it should not', () => {
    const id = playlistOf('A', 'B');
    queries.addTracks(id, [trackId('C')], null, 2);
    queries.addTracks(id, [trackId('D'), trackId('D')], 1, 3);
    expect(titlesIn(id)).toEqual(['A', 'D', 'B', 'C']);
    expect(positionsIn(id)).toEqual([0, 1, 2, 3]);
    expect(queries.summary(id)?.updatedAt).toBe(3);
  });

  it('leaves out a track the library has never heard of, rather than failing the whole add', () => {
    const id = playlistOf('A');
    queries.addTracks(id, [9999, trackId('B')], null, 2);
    expect(titlesIn(id)).toEqual(['A', 'B']);
  });

  it('a save in a new order rewrites every position, and an item that stays keeps its id', () => {
    const id = playlistOf('A', 'B', 'C', 'D');
    const [third] = itemIds(id, 2);
    queries.save(id, 'Mix', ['C', 'A', 'B', 'D'].map(trackId), 2);
    expect(titlesIn(id)).toEqual(['C', 'A', 'B', 'D']);
    expect(queries.items(id)[0]?.itemId).toBe(third);
    expect(positionsIn(id)).toEqual([0, 1, 2, 3]);
  });

  it('a save without one takes it out and closes the gap', () => {
    const id = playlistOf('A', 'B', 'C');
    queries.save(id, 'Mix', ['B', 'C'].map(trackId), 2);
    expect(titlesIn(id)).toEqual(['B', 'C']);
    expect(positionsIn(id)).toEqual([0, 1]);
  });

  it("a save leaves another playlist's items alone", () => {
    const id = playlistOf('A');
    const other = queries.create('Other', [trackId('B')], 1);
    queries.save(id, 'Mix', [trackId('B')], 2);
    expect(titlesIn(other)).toEqual(['B']);
    expect(titlesIn(id)).toEqual(['B']);
  });

  it('deleting a playlist takes its items and leaves the tracks', () => {
    const id = playlistOf('A');
    queries.delete(id);
    expect(queries.list()).toEqual([]);
    expect(trackId('A')).toBeGreaterThan(0);
  });
});

describe('missing tracks', () => {
  it('stay in the playlist, counted apart, out of the length and the art', () => {
    const id = playlistOf('A', 'B', 'C');
    markMissing('A');
    expect(titlesIn(id)).toEqual(['A', 'B', 'C']);
    expect(queries.summary(id)).toMatchObject({
      trackCount: 3,
      missingCount: 1,
      durationMs: 2000,
      covers: [{ artHash: 'b'.repeat(40), tracks: 1 }],
    });
  });

  it('an all-missing playlist has no art and no length', () => {
    const id = playlistOf('A');
    markMissing('A');
    expect(queries.summary(id)).toMatchObject({ trackCount: 1, missingCount: 1, durationMs: 0, covers: [] });
  });

  it('come back in the same place when the file does', () => {
    const id = playlistOf('A', 'B');
    markMissing('A');
    db.prepare('UPDATE files SET missing_since = NULL').run();
    expect(titlesIn(id)).toEqual(['A', 'B']);
    expect(queries.summary(id)?.missingCount).toBe(0);
  });

  it('a rescan that marks them missing removes nothing', () => {
    const id = playlistOf('A', 'B');
    createScanWriter(db, { now: () => 1, hostname: 'test' }).finish({
      missing: [
        { id: trackFileId('A'), relPath: 'A.flac', sizeBytes: 1, mtimeMs: 1, audioHash: null, missingSince: null },
      ],
      folderArt: [],
      artSources: [],
      issues: [],
      somethingChanged: true,
    });
    expect(titlesIn(id)).toEqual(['A', 'B']);
    expect(queries.summary(id)?.missingCount).toBe(1);
  });

  it('"Remove missing" takes only the missing ones from only this playlist', () => {
    const id = playlistOf('A', 'B', 'C');
    const other = queries.create('Other', [trackId('A')], 1);
    markMissing('A');
    markMissing('C');
    expect(queries.removeMissing(id, 2)).toBe(2);
    expect(titlesIn(id)).toEqual(['B']);
    expect(positionsIn(id)).toEqual([0]);
    expect(titlesIn(other)).toEqual(['A']);
  });
});

function trackFileId(title: string): number {
  const row = db.prepare<[string], { id: number }>('SELECT id FROM files WHERE rel_path = ?').get(`${title}.flac`);
  if (!row) throw new Error(`No file for ${title}`);
  return row.id;
}

describe('the handlers', () => {
  const emit = vi.fn();
  const markChanged = vi.fn();

  const MUSIC = join(tempDir('playlists-music'), 'Music');

  function handlers(picks: { exportTo?: string; importFrom?: string } = {}) {
    const queriesNow = () => createQueries(db);
    const library = {
      markChanged,
      absolutePath: (id: number) => {
        const rel = queriesNow().relPathOfTrack(id);
        return rel === null ? null : join(MUSIC, rel);
      },
      findTrack: (path: string, artist: string | null, title: string | null) =>
        queriesNow().trackAtRelPath(relative(MUSIC, path).split(sep).join('/')) ??
        (title === null ? null : queriesNow().trackByName(artist, title)),
      read: <T>(work: (read: ReturnType<typeof createQueries>) => T) => ok(work(createQueries(db))),
      perConnection:
        <Q>(create: (connection: Connection) => Q) =>
        <T>(work: (made: Q) => T) =>
          ok(work(create(db))),
    };
    return playlistHandlers({
      library: library,
      emit,
      now: () => 5,
      pickExportPath: () => Promise.resolve(picks.exportTo ?? null),
      pickImportFile: () => Promise.resolve(picks.importFrom ?? null),
    });
  }

  function run<N extends Extract<CommandName, `playlist.${string}`>>(
    name: N,
    input: CommandInput<N>,
    picks: { exportTo?: string; importFrom?: string } = {},
  ) {
    const handler = handlers(picks)[name] as unknown as (given: CommandInput<N>) => CommandResult<N>;
    return handler(input);
  }

  it('round-trips through .m3u8, and finds a moved file by its name', async () => {
    const id = playlistOf('B', 'A');
    const file = join(tempDir('playlists-m3u'), 'Mix.m3u8');
    const exported = await Promise.resolve(run('playlist.export', { playlistId: id }, { exportTo: file }));
    expect(exported).toEqual({ ok: true, value: true });
    const text = readFileSync(file, 'utf8');
    expect(text.startsWith('#EXTM3U')).toBe(true);
    expect(text).toContain('#EXTINF:1,Someone - B');

    writeFileSync(file, text.replace(join(MUSIC, 'A.flac'), join(MUSIC, 'moved', 'A.flac')));
    const imported = await Promise.resolve(run('playlist.import', undefined, { importFrom: file }));
    expect(imported).toMatchObject({ ok: true, value: { name: 'Mix (2)', matched: 2, total: 2 } });
    const playlistId = imported.ok && imported.value !== null ? imported.value.playlistId : 0;
    expect(titlesIn(playlistId)).toEqual(['B', 'A']);
  });

  it('reads a plain .m3u in the ANSI codepage, as older Windows players write one', async () => {
    const list = join(tempDir('playlists-ansi'), 'Old.m3u');
    writeFileSync(list, Buffer.from(`#EXTM3U\r\n${join(MUSIC, 'Café.flac')}\r\n`, 'latin1'));
    const imported = await Promise.resolve(run('playlist.import', undefined, { importFrom: list }));
    expect(imported).toMatchObject({ ok: true, value: { name: 'Old', matched: 1, total: 1 } });
    const playlistId = imported.ok && imported.value !== null ? imported.value.playlistId : 0;
    expect(titlesIn(playlistId)).toEqual(['Café']);
  });

  beforeEach(() => {
    emit.mockClear();
    markChanged.mockClear();
  });

  it('a write says the playlists changed, on this machine', () => {
    expect(run('playlist.create', { name: 'Mix', trackIds: [trackId('A')] })).toMatchObject({
      ok: true,
      value: { name: 'Mix', trackCount: 1 },
    });
    expect(markChanged).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith('library.changed', { scopes: ['playlists'] });
  });

  it('a name is taken whatever its case, and a refused write says nothing changed', () => {
    run('playlist.create', { name: 'Mix', trackIds: [] });
    emit.mockClear();
    expect(run('playlist.create', { name: 'MIX', trackIds: [] })).toMatchObject({
      ok: false,
      error: { code: 'name_taken' },
    });
    expect(emit).not.toHaveBeenCalled();
  });

  it('a playlist can be renamed to a different case of its own name', () => {
    const created = run('playlist.create', { name: 'Mix', trackIds: [] });
    if (!created.ok) throw new Error('Not created');
    expect(run('playlist.save', { playlistId: created.value.id, name: 'MIX', trackIds: [] }).ok).toBe(true);
    expect(queries.summary(created.value.id)?.name).toBe('MIX');
  });

  it('a playlist that has gone is not found', () => {
    expect(run('playlist.get', { playlistId: 99 })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(run('playlist.delete', { playlistId: 99 })).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('marks the missing ones', () => {
    const id = playlistOf('A', 'B');
    markMissing('B');
    const got = run('playlist.get', { playlistId: id });
    if (!got.ok) throw new Error('Not read');
    const [first, second] = got.value.items;
    expect(first?.track.isMissing).toBe(false);
    expect(second?.track.isMissing).toBe(true);
  });

  it('Remove missing says how many went', () => {
    const id = playlistOf('A', 'B');
    markMissing('A');
    expect(run('playlist.removeMissing', { playlistId: id })).toEqual({ ok: true, value: { removed: 1 } });
  });
});

describe('saving from the editor', () => {
  it('ends up with exactly those tracks in that order, keeping the items that stay', () => {
    const id = playlistOf('A', 'B', 'C');
    const before = queries.items(id);
    queries.save(id, 'Renamed', [trackId('C'), trackId('D'), trackId('A'), 999_999], 2);
    expect(titlesIn(id)).toEqual(['C', 'D', 'A']);
    expect(positionsIn(id)).toEqual([0, 1, 2]);
    const after = queries.items(id);
    expect(after[0]?.itemId).toBe(before[2]?.itemId);
    expect(after[2]?.itemId).toBe(before[0]?.itemId);
    expect(queries.summary(id)?.name).toBe('Renamed');
  });
});

describe('covers', () => {
  it('are every cover in it, most tracks first, up to the limit', () => {
    const row = (artHash: string, tracks: number) => ({ playlistId: 1, artHash, tracks });
    const many = Array.from({ length: 9 }, (_, index) => row(String.fromCharCode(97 + index), 1));
    expect(coversOf([row('z', 3), row('y', 2)])).toEqual(
      new Map([
        [
          1,
          [
            { artHash: 'z', tracks: 3 },
            { artHash: 'y', tracks: 2 },
          ],
        ],
      ]),
    );
    expect(coversOf(many).get(1)).toHaveLength(8);
  });
});
