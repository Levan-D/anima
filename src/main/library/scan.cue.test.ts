/* CUE sheets through the real scan: real generated audio, a real database, sheets written beside it. */

import { mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from '@main/db/connection';
import { runLyricsImport } from '@main/lyrics/import';
import { closeTestDatabase, finishedScan, makeTone, openTestDatabase, tempDir } from '@main/library/testFixtures';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const SHEET = `PERFORMER "Sheet Band"
TITLE "Sheet Album"
FILE "album.flac" WAVE
  TRACK 01 AUDIO
    TITLE "One"
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    TITLE "Two"
    INDEX 00 00:01:00
    INDEX 01 00:02:00
  TRACK 03 AUDIO
    TITLE "Three"
    PERFORMER "A Guest"
    INDEX 01 00:04:00
`;

type Row = {
  id: number;
  cueIndex: number;
  startMs: number;
  endMs: number | null;
  title: string;
  artist: string;
  album: string | null;
  missing: number;
};

let root: string;
let dbPath: string;
let db: Connection;

const sheetPath = () => join(root, 'album.cue');

function tracks(): Row[] {
  return db
    .prepare(
      `SELECT t.id, t.cue_index AS cueIndex, t.start_ms AS startMs, t.end_ms AS endMs, t.title, ar.name AS artist,
              al.title AS album, f.missing_since IS NOT NULL AS missing
       FROM tracks t
       JOIN files f ON f.id = t.file_id
       JOIN artists ar ON ar.id = t.artist_id
       LEFT JOIN albums al ON al.id = t.album_id
       ORDER BY t.id`,
    )
    .all() as Row[];
}

const present = () => tracks().filter(({ missing }) => missing === 0);
const issues = () => db.prepare('SELECT rel_path AS relPath, kind FROM scan_issues').all();

beforeEach(() => {
  root = tempDir('cue-scan');
  ({ dbPath, db } = openTestDatabase(tempDir('cue-scan-data')));
  makeTone(join(root, 'album.flac'), {
    frequency: 300,
    seconds: 6,
    tags: { title: 'Whole', artist: 'Tag Artist', album: 'Tag Album' },
  });
});

afterEach(() => {
  closeTestDatabase(db);
});

describe('a sheet beside a file', () => {
  it('cuts it into ranges with what the sheet says, and a pregap stays with the track before', async () => {
    writeFileSync(sheetPath(), SHEET);
    await finishedScan(root, dbPath);

    expect(present()).toMatchObject([
      { cueIndex: 1, startMs: 0, endMs: 2000, title: 'One', artist: 'Sheet Band', album: 'Sheet Album' },
      { cueIndex: 2, startMs: 2000, endMs: 4000, title: 'Two', artist: 'Sheet Band' },
      { cueIndex: 3, startMs: 4000, endMs: null, title: 'Three', artist: 'A Guest' },
    ]);
    expect(issues()).toEqual([]);
  });

  it('falls back to the file for album and artist', async () => {
    writeFileSync(
      sheetPath(),
      'FILE "album.flac" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00\nTRACK 02 AUDIO\nINDEX 01 00:02:00',
    );
    await finishedScan(root, dbPath);
    expect(present()).toMatchObject([
      { title: 'Track 01', artist: 'Tag Artist', album: 'Tag Album' },
      { title: 'Track 02', artist: 'Tag Artist', album: 'Tag Album' },
    ]);
  });

  it('keeps every id through rescans and a retag, and reads an unchanged sheet only once', async () => {
    const sheetTime = new Date(1_700_000_000_000);
    writeFileSync(sheetPath(), SHEET);
    utimesSync(sheetPath(), sheetTime, sheetTime);
    await finishedScan(root, dbPath);
    const ids = tracks().map(({ id }) => id);

    // Same size and time, different text: a read would see it.
    const { size } = statSync(sheetPath());
    writeFileSync(sheetPath(), SHEET.replace('"One"', '"Eno"'));
    expect(statSync(sheetPath()).size).toBe(size);
    utimesSync(sheetPath(), sheetTime, sheetTime);
    const quiet = await finishedScan(root, dbPath);
    expect(quiet.report).toMatchObject({ unchanged: 1, updated: 0 });
    expect(present()[0]?.title).toBe('One');

    const later = new Date(Date.now() + 5_000);
    utimesSync(join(root, 'album.flac'), later, later);
    await finishedScan(root, dbPath);
    expect(tracks().map(({ id }) => id)).toEqual(ids);
    expect(present()[0]?.title).toBe('Eno');
  });

  it('turns the whole-file row into track 1 when added, parks the rest when removed, and gives them back', async () => {
    await finishedScan(root, dbPath);
    const [whole] = tracks();
    expect(whole).toMatchObject({ cueIndex: 0, startMs: 0, endMs: null, title: 'Whole' });

    db.prepare(
      `INSERT INTO lyrics (track_id, status, plain_text, fetched_at) VALUES (?, 'found', 'words for the whole file', 1)`,
    ).run(whole?.id);
    db.prepare('INSERT INTO lyrics_offsets (track_id, offset_ms) VALUES (?, 500)').run(whole?.id);

    writeFileSync(sheetPath(), SHEET);
    const added = await finishedScan(root, dbPath);
    expect(added.report).toMatchObject({ updated: 1, unchanged: 0, added: 0 });
    const split = present();
    expect(split).toHaveLength(3);
    expect(split[0]).toMatchObject({ id: whole?.id, cueIndex: 1, title: 'One' });
    expect(db.prepare('SELECT count(*) AS n FROM lyrics').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM lyrics_offsets').get()).toEqual({ n: 0 });

    const inPlaylist = split[2]?.id;
    db.prepare(`INSERT INTO playlists (id, name, created_at, updated_at) VALUES (1, 'P', 0, 0)`).run();
    db.prepare('INSERT INTO playlist_items (playlist_id, track_id, position) VALUES (1, ?, 0)').run(inPlaylist);
    db.prepare('INSERT INTO play_events (track_id, played_at, listened_ms) VALUES (?, 1, 30000)').run(inPlaylist);

    rmSync(sheetPath());
    await finishedScan(root, dbPath);
    expect(present()).toMatchObject([{ id: whole?.id, cueIndex: 0, startMs: 0, endMs: null, title: 'Whole' }]);
    expect(
      tracks()
        .filter(({ missing }) => missing === 1)
        .map(({ id }) => id),
    ).toEqual(split.slice(1).map(({ id }) => id));
    expect(db.prepare('SELECT count(*) AS n FROM playlist_items').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT count(*) AS n FROM play_events').get()).toEqual({ n: 1 });

    writeFileSync(sheetPath(), SHEET);
    await finishedScan(root, dbPath);
    expect(present().map(({ id }) => id)).toEqual(split.map(({ id }) => id));
  });

  it('survives a parked row on the next quiet scan', async () => {
    writeFileSync(sheetPath(), SHEET);
    await finishedScan(root, dbPath);
    rmSync(sheetPath());
    await finishedScan(root, dbPath);
    const quiet = await finishedScan(root, dbPath);
    expect(quiet.report).toMatchObject({ updated: 0, nowMissing: 0 });
    expect(present()).toHaveLength(1);
  });

  it('follows a folder moved with its sheet', async () => {
    writeFileSync(sheetPath(), SHEET);
    await finishedScan(root, dbPath);
    const ids = tracks().map(({ id }) => id);

    const bytes = readFileSync(join(root, 'album.flac'));
    rmSync(join(root, 'album.flac'));
    rmSync(sheetPath());
    mkdirSync(join(root, 'moved'));
    writeFileSync(join(root, 'moved', 'album.flac'), bytes);
    writeFileSync(join(root, 'moved', 'album.cue'), SHEET);
    await finishedScan(root, dbPath);
    expect(present().map(({ id }) => id)).toEqual(ids);
  });
});

describe('a sheet that cuts nothing', () => {
  it('names a file that is not there: an issue, and the audio stays whole', async () => {
    writeFileSync(sheetPath(), SHEET.replace('album.flac', 'elsewhere.flac'));
    await finishedScan(root, dbPath);
    expect(present()).toMatchObject([{ cueIndex: 0, title: 'Whole' }]);
    expect(issues()).toEqual([{ relPath: 'album.cue', kind: 'cue_file_missing' }]);

    const again = await finishedScan(root, dbPath);
    expect(again.report).toMatchObject({ issues: 1 });
    expect(issues()).toEqual([{ relPath: 'album.cue', kind: 'cue_file_missing' }]);
  });

  it('picks the file up when it arrives', async () => {
    rmSync(join(root, 'album.flac'));
    writeFileSync(sheetPath(), SHEET);
    await finishedScan(root, dbPath);
    expect(issues()).toEqual([{ relPath: 'album.cue', kind: 'cue_file_missing' }]);

    makeTone(join(root, 'album.flac'), { frequency: 300, seconds: 6, tags: { title: 'Whole' } });
    await finishedScan(root, dbPath);
    expect(present()).toHaveLength(3);
    expect(issues()).toEqual([]);
  });

  it('is malformed: an issue, and the audio stays whole', async () => {
    writeFileSync(sheetPath(), 'FILE "album.flac" WAVE\nTRACK 01 AUDIO\nINDEX 01 banana');
    await finishedScan(root, dbPath);
    expect(present()).toMatchObject([{ cueIndex: 0, title: 'Whole' }]);
    expect(issues()).toEqual([{ relPath: 'album.cue', kind: 'bad_cue' }]);
  });

  it('goes past the end of the file: an issue, and the audio stays whole', async () => {
    writeFileSync(sheetPath(), SHEET.replace('00:04:00', '09:00:00'));
    await finishedScan(root, dbPath);
    expect(present()).toMatchObject([{ cueIndex: 0, title: 'Whole' }]);
    expect(issues()).toEqual([{ relPath: 'album.cue', kind: 'bad_cue' }]);
  });

  it('calls its files tracks already: no issue, nothing changes', async () => {
    writeFileSync(
      sheetPath(),
      'FILE "album.wav" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00\nFILE "b.wav" WAVE\nTRACK 02 AUDIO\nINDEX 01 00:00:00',
    );
    await finishedScan(root, dbPath);
    expect(present()).toMatchObject([{ cueIndex: 0, title: 'Whole' }]);
    expect(issues()).toEqual([]);
  });

  it('wants a file another sheet has already cut up', async () => {
    writeFileSync(sheetPath(), SHEET);
    writeFileSync(join(root, 'other.cue'), SHEET);
    await finishedScan(root, dbPath);
    expect(present()).toHaveLength(3);
    expect(issues()).toEqual([{ relPath: 'other.cue', kind: 'bad_cue' }]);
  });
});

describe('lyrics', () => {
  it('a lyrics library import leaves the tracks of a CUE album alone', async () => {
    writeFileSync(sheetPath(), SHEET);
    await finishedScan(root, dbPath);
    const { hash } = db.prepare('SELECT audio_hash AS hash FROM files').get() as { hash: string };

    const sourcePath = join(tempDir('cue-lyrics'), 'lyrics.db');
    const source = new Database(sourcePath);
    source.exec(
      'CREATE TABLE lyrics (rel_path TEXT, audio_hash TEXT, status TEXT, synced_lrc TEXT, plain_text TEXT, fetched_at INT)',
    );
    source
      .prepare(`INSERT INTO lyrics VALUES ('album.flac', ?, 'found', NULL, 'words for the whole file', 1)`)
      .run(hash);
    source.close();

    const report = runLyricsImport({ sourcePath, dbPath });
    expect(report).toMatchObject({ ok: true, value: { rows: 1, matched: 0, added: 0 } });
    expect(db.prepare('SELECT count(*) AS n FROM lyrics').get()).toEqual({ n: 0 });
  });
});
