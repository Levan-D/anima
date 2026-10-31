import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Connection } from '@main/db/connection';
import {
  closeTestDatabase,
  copyOfBaseLibrary,
  finishedScan,
  openTestDatabase,
  tempDir,
} from '@main/library/testFixtures';
import { importInWorker, runLyricsImport } from './import';

type LibraryRow = { id: number; hash: string };
type SourceRow = { hash: string; status: 'found' | 'not_found' | 'instrumental'; synced?: string; plain?: string };

let dbPath: string;
let db: Connection;
let tracks: LibraryRow[];

beforeAll(async () => {
  const opened = openTestDatabase(tempDir('lyrics-import'));
  ({ dbPath, db } = opened);
  await finishedScan(copyOfBaseLibrary('lyrics-import-music'), dbPath);
  tracks = db
    .prepare<[], LibraryRow>(
      'SELECT t.id, f.audio_hash AS hash FROM tracks t JOIN files f ON f.id = t.file_id WHERE f.audio_hash IS NOT NULL ORDER BY t.id',
    )
    .all();
  return () => closeTestDatabase(db);
});

afterEach(() => {
  db.exec('DELETE FROM lyrics');
});

function lyricsFile(rows: SourceRow[]): string {
  const path = join(tempDir('lyrics-source'), 'lyrics.db');
  const source = new Database(path);
  source.exec(`CREATE TABLE lyrics (
    rel_path TEXT PRIMARY KEY, audio_hash TEXT NOT NULL, artist TEXT NOT NULL, album TEXT, title TEXT NOT NULL,
    duration_ms INTEGER NOT NULL, status TEXT NOT NULL, synced_lrc TEXT, plain_text TEXT, matched_via TEXT,
    lrclib_id INTEGER, lrclib_artist TEXT, lrclib_album TEXT, lrclib_title TEXT, lrclib_duration REAL,
    fetched_at INTEGER NOT NULL)`);
  const insert = source.prepare(
    "INSERT INTO lyrics (rel_path, audio_hash, artist, title, duration_ms, status, synced_lrc, plain_text, fetched_at) VALUES (?, ?, 'a', 't', 1, ?, ?, ?, 7)",
  );
  rows.forEach(({ hash, status, synced, plain }, index) => {
    insert.run(`file ${index}`, hash, status, synced ?? null, plain ?? null);
  });
  source.close();
  return path;
}

function hashOf(index: number): string {
  const row = tracks[index];
  if (!row) throw new Error('Not enough tracks in the fixture');
  return row.hash;
}

function idOf(index: number): number {
  const row = tracks[index];
  if (!row) throw new Error('Not enough tracks in the fixture');
  return row.id;
}

const stored = (trackId: number) => db.prepare('SELECT * FROM lyrics WHERE track_id = ?').get(trackId);

describe('runLyricsImport', () => {
  it('matches by hash, and leaves not_found rows behind', () => {
    const sourcePath = lyricsFile([
      { hash: hashOf(0), status: 'found', synced: '[00:01.00]plum', plain: 'plum' },
      { hash: hashOf(1), status: 'instrumental' },
      { hash: hashOf(2), status: 'not_found' },
      { hash: 'not in this library', status: 'found', plain: 'pear' },
    ]);

    expect(runLyricsImport({ sourcePath, dbPath })).toEqual({
      ok: true,
      value: { rows: 3, leftBehind: 1, matched: 2, added: 2, kept: 0 },
    });
    expect(stored(idOf(0))).toMatchObject({
      status: 'found',
      synced_lrc: '[00:01.00]plum',
      plain_text: 'plum',
      fetched_at: 7,
    });
    expect(stored(idOf(1))).toMatchObject({ status: 'instrumental', synced_lrc: null });
    expect(stored(idOf(2))).toBeUndefined();
  });

  it('reports a worker that exits without an answer, instead of waiting for good', async () => {
    const workerPath = join(tempDir('lyrics-import-worker'), 'gone.cjs');
    writeFileSync(workerPath, 'process.exit(0);');
    const result = await importInWorker(workerPath)({ sourcePath: 'unused', dbPath: 'unused' });
    expect(result).toMatchObject({ ok: false, error: { code: 'unexpected' } });
  });

  it('keeps what LRCLIB gave, and replaces only a not_found', () => {
    const insert = db.prepare('INSERT INTO lyrics (track_id, status, plain_text, fetched_at) VALUES (?, ?, ?, 1)');
    insert.run(idOf(0), 'found', 'quince');
    insert.run(idOf(1), 'instrumental', null);
    insert.run(idOf(2), 'not_found', null);
    const sourcePath = lyricsFile([0, 1, 2].map((index) => ({ hash: hashOf(index), status: 'found', plain: 'pear' })));

    expect(runLyricsImport({ sourcePath, dbPath })).toMatchObject({ value: { matched: 3, added: 1, kept: 2 } });
    expect(stored(idOf(0))).toMatchObject({ plain_text: 'quince' });
    expect(stored(idOf(1))).toMatchObject({ status: 'instrumental' });
    expect(stored(idOf(2))).toMatchObject({ status: 'found', plain_text: 'pear' });
  });

  it('refuses a database that is not a lyrics library, such as a library itself', () => {
    expect(runLyricsImport({ sourcePath: dbPath, dbPath })).toMatchObject({
      ok: false,
      error: { code: 'file_unreadable' },
    });
  });

  it('refuses a file that is not a database', () => {
    const sourcePath = join(tempDir('lyrics-source'), 'missing.db');
    expect(runLyricsImport({ sourcePath, dbPath })).toMatchObject({ ok: false, error: { code: 'file_unreadable' } });
  });
});
