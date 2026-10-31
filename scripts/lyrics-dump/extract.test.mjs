import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { forEachTableCell, isTableLeafPage, parseHeader } from './sqlitePages.mjs';
import {
  gzipFile,
  makeTempDir,
  openDump,
  removeTempDir,
  seededRandom,
  spillBoundaries,
  writeLibrary,
} from './testFixtures.mjs';

// Every test spawns node, and each spawn loads vite, which can take seconds on a busy machine.
vi.setConfig({ testTimeout: 120_000 });

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const EXTRACT = resolve(SCRIPTS, 'extract.mjs');
const MATCH = resolve(SCRIPTS, 'match.mjs');

const LYRICS_COLUMNS = [
  'track_id',
  'plain_lyrics',
  'synced_lyrics',
  'has_plain_lyrics',
  'has_synced_lyrics',
  'instrumental',
  'source',
  'created_at',
  'updated_at',
  'lyricsfile',
  'has_lyricsfile',
  'has_word_sync',
];
const TRACK_COLUMNS = ['name', 'artist_name', 'album_name', 'duration', 'last_lyrics_id'];

const SONG = { title: 'Boundary Song', artist: 'Test Artist', album: 'Test Album', durationMs: 200_000 };
const LIBRARY = [
  SONG,
  { title: 'Live One (Live)', artist: 'Band & Friends', album: null, durationMs: 180_500 },
  { title: 'Tiny One', artist: 'Tiny', album: 'Tiny Album', durationMs: 5_000 },
];

let dir = '';
let nextFile = 0;

beforeAll(() => {
  dir = makeTempDir();
  writeLibrary(libraryPath(), LIBRARY);
});

afterAll(() => {
  removeTempDir(dir);
});

function libraryPath() {
  return join(dir, 'library.db');
}

function tempPath(name) {
  nextFile += 1;
  return join(dir, `${nextFile}-${name}`);
}

function runExtract({ dump, out, library = libraryPath() }) {
  return spawnSync(process.execPath, [EXTRACT, '--library', library, '--dump', dump, '--out', out], {
    encoding: 'utf8',
  });
}

// Fails the process's nth read of a file, as a bad disk would. Reading the header is the first, then one for each pass.
const FAIL_A_READ = `data:text/javascript,${encodeURIComponent(`
  import fs from 'node:fs';
  import { syncBuiltinESMExports } from 'node:module';
  const { createReadStream } = fs;
  let reads = 0;
  fs.createReadStream = (path, options) => {
    reads += 1;
    return createReadStream(reads === Number(process.env.FAIL_ON_READ) ? 'no such file' : path, options);
  };
  syncBuiltinESMExports();
`)}`;

function runExtractFailingOnRead(read, { dump, out, library = libraryPath() }) {
  return spawnSync(
    process.execPath,
    ['--import', FAIL_A_READ, EXTRACT, '--library', library, '--dump', dump, '--out', out],
    { encoding: 'utf8', env: { ...process.env, FAIL_ON_READ: String(read) } },
  );
}

function runMatch({ extract, library = libraryPath(), out = tempPath('lyrics.db') }) {
  return spawnSync(process.execPath, [MATCH, '--library', library, '--extract', extract, '--out', out], {
    encoding: 'utf8',
  });
}

function readMeta(path) {
  const db = new Database(path, { readonly: true });
  const rows = db.prepare('SELECT key, value FROM meta').all();
  db.close();
  return Object.fromEntries(rows.map(({ key, value }) => [key, JSON.parse(value)]));
}

function extractOf(build, options = {}) {
  const source = tempPath('dump.sqlite3');
  const expected = build(source, options);
  const dump = `${source}.gz`;
  gzipFile(source, dump);
  const out = tempPath('extract.db');
  const result = runExtract({ dump, out });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return { source, dump, out, expected, stdout: result.stdout, meta: readMeta(out) };
}

/** A column's storage class and exact bytes, and its value, which is what tells two doubles apart. */
function snapshotOf(path, table, columns) {
  const db = new Database(path, { readonly: true });
  const select = columns.flatMap((column) => [`typeof(${column})`, `hex(${column})`, column]).join(', ');
  const statement = db.prepare(`SELECT id, ${select} FROM ${table} ORDER BY id`).raw();
  const rows = new Map(statement.all().map(([id, ...values]) => [id, values]));
  db.close();
  return rows;
}

function expectSameRows(source, table, out, outTable, columns, ids) {
  const fromSource = snapshotOf(source, table, columns);
  const fromOut = snapshotOf(out, outTable, columns);
  expect([...fromOut.keys()].sort((a, b) => a - b)).toEqual([...ids].sort((a, b) => a - b));
  for (const id of ids) {
    expect(fromSource.has(id), `source row ${id}`).toBe(true);
    expect(fromOut.get(id), `${outTable} row ${id}`).toEqual(fromSource.get(id));
  }
}

function pagesOf(path) {
  const bytes = readFileSync(path);
  const header = parseHeader(bytes);
  const page = (pageNumber) => bytes.subarray((pageNumber - 1) * header.pageSize, pageNumber * header.pageSize);
  return { bytes, header, page };
}

function cellsWithRowid(path, rowid) {
  const { header, page } = pagesOf(path);
  const cells = [];
  for (let pageNumber = 1; pageNumber <= header.pageCount; pageNumber += 1) {
    const leaf = page(pageNumber);
    if (!isTableLeafPage(leaf, pageNumber, header)) continue;
    forEachTableCell(leaf, pageNumber, header, (_page, cell) => {
      if (cell.rowid === rowid) cells.push({ ...cell, leafPage: pageNumber });
    });
  }
  return cells;
}

function payloadSizesOfRowids(path, rowids) {
  const { header, page } = pagesOf(path);
  const sizes = new Set();
  for (let pageNumber = 1; pageNumber <= header.pageCount; pageNumber += 1) {
    const leaf = page(pageNumber);
    if (!isTableLeafPage(leaf, pageNumber, header)) continue;
    forEachTableCell(leaf, pageNumber, header, (_page, cell) => {
      if (rowids.has(cell.rowid)) sizes.add(cell.payloadSize);
    });
  }
  return sizes;
}

function fakeText(random, targetBytes) {
  const pieces = ['la ', 'na\n', 'é', 'ß', '€', '語', '𝄞', '[00:01.00] '];
  let text = '';
  let bytes = 0;
  while (bytes < targetBytes) {
    const piece = pieces[Math.floor(random() * pieces.length)];
    text += piece;
    bytes += Buffer.byteLength(piece);
  }
  return text;
}

/**
 * Every kind of row the extract has to get right, planted through the dump's real schema, with what it should do with
 * each. Rows go in across all four generations of the lyrics table, so old rows keep their shorter records.
 */
function plantEverything(path, { pageSize = 4096, vacuum = false, wal = false, noiseRows = 300 } = {}) {
  const dump = openDump(path, { pageSize, wal });
  const random = seededRandom(pageSize + (vacuum ? 1 : 0));
  const keptTracks = new Map();
  const keptLyrics = new Set();
  const notFound = new Set();
  const boundaryRowids = new Set();
  let album = 0;

  const addSongTrack = (overrides = {}) => {
    album += 1;
    return dump.addTrack({
      name: SONG.title,
      artist: SONG.artist,
      album: `Album ${album}`,
      duration: 200,
      ...overrides,
    });
  };

  const plant = (fields, trackOverrides = {}) => {
    const trackId = addSongTrack(trackOverrides);
    keptTracks.set(trackId, 1);
    const lyricsId = dump.addLyrics(trackId, fields);
    keptLyrics.add(lyricsId);
    return lyricsId;
  };

  const plantBoundaryRows = () => {
    for (const size of [0, 1, 488, 489, 490, 4060, 4061, 4062, 4580, 4581]) plant({ plain: 'b'.repeat(size) });
    for (const size of [0, 1, 4061, 4062]) plant({ plain: null, synced: 's'.repeat(size) });
    for (const payloadSize of spillBoundaries(pageSize)) {
      const trackId = addSongTrack();
      const lyricsId = dump.addLyricsOfPayload(trackId, payloadSize);
      if (lyricsId === null) {
        keptTracks.delete(trackId);
        dump.db.prepare('DELETE FROM tracks WHERE id = ?').run(trackId);
        continue;
      }
      keptTracks.set(trackId, 1);
      keptLyrics.add(lyricsId);
      boundaryRowids.add(lyricsId);
    }
    for (let padding = 0; padding < 4; padding += 1) {
      const lead = 'x'.repeat(padding);
      plant({ plain: `${lead}${'€'.repeat(pageSize * 2)}`, synced: `${lead}${'𝄞'.repeat(pageSize)}` });
      plant({ plain: `${lead}${'é'.repeat(pageSize * 3)}` });
    }
  };

  const plantNoise = (rows) => {
    for (let i = 0; i < rows; i += 1) {
      album += 1;
      const trackId = dump.addTrack({
        name: `Noise ${album}`,
        artist: 'Nobody',
        album: `Album ${album}`,
        duration: 60 + (album % 300),
      });
      const size = Math.floor(random() * random() * pageSize * 3);
      dump.addLyrics(trackId, {
        plain: fakeText(random, size),
        synced: random() < 0.5 ? fakeText(random, size) : null,
      });
      if (i % 5 === 0) {
        dump.addMissingTrack({ name: `Missing ${album}`, artist: 'Nobody', album: `Album ${album}`, duration: 100 });
      }
      if (i % 4 === 0) {
        const wantedSize = Math.floor(random() * random() * pageSize * 6);
        plant({
          plain: random() < 0.9 ? fakeText(random, wantedSize) : null,
          synced: random() < 0.5 ? fakeText(random, wantedSize) : null,
        });
      }
    }
  };

  dump.db.exec('BEGIN');

  plantNoise(noiseRows);
  plantBoundaryRows();
  dump.addLyricsColumn();

  plantNoise(noiseRows);
  plantBoundaryRows();
  plant({ lyricsfile: 'version: 1\nlines: []\n' });
  dump.addLyricsColumn();

  plantNoise(noiseRows);
  plantBoundaryRows();
  dump.addLyricsColumn();

  plantNoise(noiseRows);
  plantBoundaryRows();

  for (const size of [100_000, 250_000]) plant({ plain: fakeText(random, size), synced: fakeText(random, size) });

  plant({ plain: null, synced: null, instrumental: 1 });
  plant({ plain: '', synced: '' });
  plant({ plain: '', synced: null, source: null, createdAt: null, updatedAt: null });
  plant({ plain: 'plain', synced: 'synced', createdAt: 1_700_000_000, updatedAt: 1_700_000_000.5 });
  plant({ plain: 'hello\u0000world', synced: 'embedded NUL' });
  plant({ plain: 'la', lyricsfile: Buffer.from([0, 1, 2, 3]) });
  plant({ source: Buffer.from([9, 9]), plain: 'la' });
  plant({ plain: 'x', hasPlain: 0, hasSynced: 1, instrumental: 1, hasLyricsfile: 1, hasWordSync: 1 });
  plant({ plain: null, synced: null, lyricsfile: 'y'.repeat(9000), hasLyricsfile: 1 });

  // Durations: whole, fractional, zero, one, and on either side of the window around 5 and 200 seconds.
  const tiny = { name: 'Tiny One', artist: 'Tiny' };
  for (const duration of [0, 1, 12.5, 20]) plant({ plain: 'la' }, { ...tiny, duration });
  for (const duration of [185, 215, 199.5, 200.25, 214.999]) plant({ plain: 'la' }, { duration });
  const outOfWindow = [184.5, 215.5, 184, 216, -1, 70000];
  const stranger = { artist: 'Somebody Else' };
  for (const duration of outOfWindow) dump.addLyrics(addSongTrack({ ...stranger, duration }), { plain: 'la' });

  // The artist's own record with the same title counts further out, down to a minute shorter than the track.
  for (const duration of [184.5, 215.5, 184, 216, 140, 70000]) plant({ plain: 'la' }, { duration });
  for (const duration of [139.5, -1]) dump.addLyrics(addSongTrack({ duration }), { plain: 'la' });

  // Titles: the library's base title, and a dump title carrying its own suffix.
  plant({ plain: 'la' }, { name: 'Boundary Song (Remastered 2011)' });
  plant({ plain: 'la' }, { name: 'Boundary Song - 2011 Remaster' });
  plant({ plain: 'la' }, { name: 'BOUNDARY SONG' });
  plant({ plain: 'la' }, { name: 'Live One', artist: 'Band and Friends', duration: 180 });
  plant({ plain: 'la' }, { name: 'Live One (Live)', artist: 'BAND & FRIENDS', duration: 181 });

  // Artists: contained words match, in either direction. Anyone else is kept, with no lyrics.
  plant({ plain: 'la' }, { artist: 'Test Artist feat. Someone Else' });
  plant({ plain: 'la' }, { artist: 'Test' });
  plant({ plain: 'la' }, { name: 'Tiny One', artist: 'Tiny Band', duration: 5 });
  for (const artist of ['Testers', 'Artist Test', 'Somebody Else']) {
    const trackId = addSongTrack({ artist });
    keptTracks.set(trackId, 0);
    dump.addLyrics(trackId, { plain: 'not wanted, as the artist is wrong' });
  }

  // An album may be missing, but a row missing anything else can't be matched.
  plant({ plain: 'la' }, { album: null });
  const strangerWithNoAlbum = addSongTrack({ artist: 'Somebody Else', album: null });
  keptTracks.set(strangerWithNoAlbum, 0);
  dump.addLyrics(strangerWithNoAlbum, { plain: 'la' });
  dump.addLyrics(addSongTrack({ name: null }), { plain: 'la' });
  dump.addLyrics(addSongTrack({ artist: null }), { plain: 'la' });
  dump.addLyrics(addSongTrack({ duration: null }), { plain: 'la' });
  addSongTrack();

  // Too long to read off its leaf page: the fields it's needed for spill.
  dump.addLyrics(addSongTrack({ name: `${SONG.title} ${'long '.repeat(pageSize)}`.trim() }), { plain: 'la' });

  // Each of these differs from a table's shape in one field alone, so it fits neither.
  dump.addMissingTrack({ name: SONG.title, artist: SONG.artist, album: 'No dates', duration: 200, date: null });
  dump.db
    .prepare('INSERT INTO missing_tracks (name, name_lower, artist_name, duration) VALUES (?, ?, ?, ?)')
    .run('Half empty', 'half empty', 'Someone', 100);

  // A lyrics row that's wanted, sharing its rowid with rows of other tables. Some of those pass for lyrics rows.
  const shared = 500_000;
  for (const id of [shared, shared + 1, shared + 2]) {
    const trackId = addSongTrack();
    keptTracks.set(trackId, 1);
    keptLyrics.add(dump.addLyrics(trackId, { id, plain: `${id} `.repeat(id === shared + 2 ? 3000 : 3) }));
  }
  const noArtist = { artist: null, album: null };
  dump.addTrack({ id: shared, name: 'Shares a rowid', duration: 100, ...noArtist });
  dump.addMissingTrack({ id: shared, name: 'Shares a rowid', duration: 100, ...noArtist });
  dump.addTrack({ id: shared + 1, name: 'Shares a rowid', artist: 'A', album: 'B', duration: 100 });
  dump.addMissingTrack({ id: shared + 1, name: 'Shares a rowid', artist: 'A', album: 'B', duration: 100 });
  dump.addMissingTrack({ id: shared + 2, name: 'Spills '.repeat(3000), duration: 100, ...noArtist });
  dump.db.prepare('INSERT INTO flags (id, content) VALUES (?, ?)').run(shared, 'a flag sharing a rowid');

  // A kept track pointing at lyrics that aren't there, or that belong to another track.
  const dangling = addSongTrack();
  keptTracks.set(dangling, 1);
  dump.db.prepare('UPDATE tracks SET last_lyrics_id = 999999 WHERE id = ?').run(dangling);
  notFound.add(999999);

  const otherTrack = dump.addTrack({ name: 'Elsewhere', artist: 'Nobody', album: 'Nothing', duration: 100 });
  const othersLyrics = dump.addLyrics(otherTrack, { plain: 'belongs to another track' });
  const borrower = addSongTrack();
  keptTracks.set(borrower, 1);
  dump.db.prepare('UPDATE tracks SET last_lyrics_id = ? WHERE id = ?').run(othersLyrics, borrower);
  notFound.add(othersLyrics);

  // Two kept tracks pointing at one row: it's wanted once, and it belongs to the first.
  const owner = addSongTrack();
  const sharedLyrics = dump.addLyrics(owner, { plain: 'shared by two tracks' });
  keptTracks.set(owner, 1);
  keptLyrics.add(sharedLyrics);
  const sharer = addSongTrack();
  keptTracks.set(sharer, 1);
  dump.db.prepare('UPDATE tracks SET last_lyrics_id = ? WHERE id = ?').run(sharedLyrics, sharer);

  // Text columns holding a blob don't fit the lyrics table, so this row is reported as not found.
  const blobbed = addSongTrack();
  keptTracks.set(blobbed, 1);
  notFound.add(dump.addLyrics(blobbed, { plain: Buffer.from('not text') }));

  plantNoise(noiseRows);

  dump.db.exec('COMMIT');
  dump.finish({ vacuum });

  return { keptTracks, keptLyrics, notFound, boundaryRowids };
}

function expectExtractMatchesSource({ source, out, expected, meta }) {
  const { keptTracks, keptLyrics, notFound } = expected;

  expectSameRows(source, 'tracks', out, 'dump_tracks', TRACK_COLUMNS, [...keptTracks.keys()]);
  expectSameRows(source, 'lyrics', out, 'dump_lyrics', LYRICS_COLUMNS, [...keptLyrics]);

  const db = new Database(out, { readonly: true });
  const matched = db.prepare('SELECT id, credit_matched FROM dump_tracks').all();
  db.close();
  for (const { id, credit_matched: creditMatched } of matched) {
    expect(creditMatched, `credit_matched of ${id}`).toBe(keptTracks.get(id));
  }

  const oracle = new Database(source, { readonly: true });
  const countRows = (table) => oracle.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get();
  const sequence = oracle.prepare('SELECT name, seq FROM sqlite_sequence').all();
  const analyzed = oracle
    .prepare('SELECT tbl, MAX(CAST(stat AS INTEGER)) AS rows_seen FROM sqlite_stat1 GROUP BY tbl')
    .all();
  const isWithLyricsfileOnly = oracle.prepare(
    'SELECT COUNT(*) FROM lyrics WHERE id = ? AND has_lyricsfile AND synced_lyrics IS NULL',
  );
  const lyricsfileWithoutSynced = [...keptLyrics].reduce((sum, id) => sum + isWithLyricsfileOnly.pluck().get(id), 0);
  const tracksRows = countRows('tracks');
  const lyricsRows = countRows('lyrics');
  oracle.close();

  expect(meta.tracks_rows_seen).toBe(tracksRows);
  // Two missing_tracks rows pass for lyrics rows, and the lyrics row holding a blob doesn't.
  expect(meta.lyrics_rows_seen).toBe(lyricsRows + 2 - 1);
  expect(meta.tracks_rows_too_long).toBe(1);
  expect(meta.too_long_title_hits).toEqual([]);
  expect(meta.sqlite_sequence).toEqual(Object.fromEntries(sequence.map(({ name, seq }) => [name, seq])));
  expect(meta.rows_at_last_analyze).toEqual(
    Object.fromEntries(analyzed.map(({ tbl, rows_seen: rows }) => [tbl, rows])),
  );
  expect(meta.unreadable_cells).toBe(0);
  expect(meta.malformed_records).toBe(0);
  expect(meta.duplicate_track_rowids).toBe(0);
  expect(meta.rows_kept).toBe(keptTracks.size);
  expect(meta.found).toBe(keptLyrics.size);
  expect(meta.wanted).toBe(keptLyrics.size + notFound.size);
  expect(meta.unreadable_ids).toEqual([]);
  expect(new Set(meta.not_found_ids)).toEqual(notFound);
  // Four are planted, but once the genuine row is in, a look-alike further along isn't read, so it depends on the layout.
  expect(meta.look_alikes).toBeGreaterThanOrEqual(1);
  expect(meta.look_alikes).toBeLessThanOrEqual(4);
  expect(meta.lyricsfile_without_synced).toBe(lyricsfileWithoutSynced);
  expect(meta.lyricsfile_without_synced).toBeGreaterThan(0);

  const pageCount = parseHeader(readFileSync(source)).pageCount;
  expect(meta.passes[0].pagesRead).toBe(pageCount);
  expect(Object.values(meta.first_byte_counts).reduce((sum, pages) => sum + pages, 0)).toBe(pageCount);
  expect(meta.passes.length).toBeGreaterThanOrEqual(2);
  expect(meta.passes.length).toBeLessThanOrEqual(3);
}

describe('the extract, compared with what SQLite reads from the same file', () => {
  it('gets every row right in a file that has never been VACUUMed', () => {
    const run = extractOf(plantEverything, { wal: true });
    expectExtractMatchesSource(run);
    expect(readFileSync(run.source)[18]).toBe(2);

    const db = new Database(run.source, { readonly: true });
    const integrity = db.pragma('integrity_check', { simple: true });
    expect(db.pragma('freelist_count', { simple: true })).toBe(0);
    db.close();
    expect(integrity).toBe('ok');

    const sizes = payloadSizesOfRowids(run.source, run.expected.boundaryRowids);
    for (const size of [4060, 4061, 4062, 4580, 4581, 8153, 8154, 8672, 8673])
      expect(sizes.has(size), `${size}`).toBe(true);
  });

  it('gets every row right in a VACUUMed file', () => {
    expectExtractMatchesSource(extractOf(plantEverything, { vacuum: true }));
  });

  it('reads through small pages, whose local parts are tiny', () => {
    expectExtractMatchesSource(extractOf(plantEverything, { pageSize: 1024, noiseRows: 100 }));
  });

  it('reads through the largest pages', () => {
    expectExtractMatchesSource(extractOf(plantEverything, { pageSize: 65536, vacuum: true, noiseRows: 30 }));
  });

  it('never prints a lyric', () => {
    const run = extractOf(plantEverything, { noiseRows: 20 });
    const db = new Database(run.out, { readonly: true });
    const texts = db.prepare('SELECT plain_lyrics FROM dump_lyrics WHERE length(plain_lyrics) > 20').pluck().all();
    db.close();
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) expect(run.stdout.includes(text.slice(0, 20))).toBe(false);
  });
});

function buildBackwardChain(path) {
  const dump = openDump(path);
  dump.db.exec('BEGIN');
  const doomed = [];
  for (let i = 0; i < 60; i += 1) {
    const trackId = dump.addTrack({ name: `Doomed ${i}`, artist: 'Nobody', album: 'None', duration: 100 + i });
    doomed.push(dump.addLyrics(trackId, { plain: 'd'.repeat(20_000) }));
    dump.addMissingTrack({ name: `Doomed ${i}`, artist: 'Nobody', album: 'None', duration: 100 + i });
  }
  dump.db.exec('COMMIT');

  const kill = dump.db.prepare('DELETE FROM lyrics WHERE id = ?');
  for (const id of doomed) kill.run(id);
  expect(dump.db.pragma('freelist_count', { simple: true })).toBeGreaterThan(0);

  const random = seededRandom(3);
  const keptLyrics = [];
  const keptTracks = new Map();
  dump.db.exec('BEGIN');
  for (let i = 0; i < 40; i += 1) {
    const trackId = dump.addTrack({ name: SONG.title, artist: SONG.artist, album: `Album ${i}`, duration: 200 });
    keptTracks.set(trackId, 1);
    keptLyrics.push(dump.addLyrics(trackId, { plain: fakeText(random, 30_000), synced: fakeText(random, 5_000) }));
  }
  dump.db.exec('COMMIT');
  dump.finish();
  return { keptLyrics: new Set(keptLyrics), keptTracks };
}

function chainOf(path, rowid) {
  const { page } = pagesOf(path);
  const chain = [];
  const cells = cellsWithRowid(path, rowid);
  const cell = cells.find(({ overflowPage }) => overflowPage > 0);
  if (cell === undefined) return { leafPage: 0, chain };
  for (let next = cell.overflowPage; next !== 0; next = page(next).readUInt32BE(0)) chain.push(next);
  return { leafPage: cell.leafPage, chain };
}

function goesBackward({ leafPage, chain }) {
  return chain.some((pageNumber, index) => pageNumber < (index === 0 ? leafPage : chain[index - 1]));
}

/** Moves a row's overflow pages around among the same page numbers, in the order `arrange` gives. SQLite reads it the same. */
function rearrangeChain(bytes, header, rowid, path, arrange) {
  const [cell] = cellsWithRowid(path, rowid).filter(({ overflowPage }) => overflowPage > 0);
  const { chain, leafPage } = chainOf(path, rowid);
  const pageAt = (pageNumber) => (pageNumber - 1) * header.pageSize;
  const pieces = chain.map((pageNumber) =>
    Buffer.from(bytes.subarray(pageAt(pageNumber), pageAt(pageNumber) + header.pageSize)),
  );
  const arranged = arrange(chain);
  arranged.forEach((pageNumber, index) => {
    pieces[index].copy(bytes, pageAt(pageNumber));
    bytes.writeUInt32BE(arranged[index + 1] ?? 0, pageAt(pageNumber));
  });
  bytes.writeUInt32BE(arranged[0], pageAt(leafPage) + cell.localStart + cell.localSize);
}

const reversed = (chain) => chain.toReversed();

function shuffled(chain) {
  const random = seededRandom(chain.length);
  const keyed = chain.map((pageNumber) => [random(), pageNumber]);
  return keyed.toSorted(([a], [b]) => a - b).map(([, pageNumber]) => pageNumber);
}

/** A dump holding a row whose overflow pages come in the order `arrange` gives, and whatever `addRows` puts before it. */
function dumpWithRearrangedChain(overflowPages, arrange, addRows = () => null) {
  const source = tempPath('rearranged.sqlite3');
  const dump = openDump(source);
  const others = addRows(dump);
  const trackId = dump.addTrack({ name: SONG.title, artist: SONG.artist, album: 'One', duration: 200 });
  const lyricsId = dump.addLyrics(trackId, { plain: 'r'.repeat((overflowPages - 1) * 4092 + 2000) });
  dump.finish();

  const { bytes, header } = pagesOf(source);
  rearrangeChain(bytes, header, lyricsId, source, arrange);
  writeFileSync(source, bytes);
  const gz = `${source}.gz`;
  gzipFile(source, gz);

  const oracle = new Database(source, { readonly: true });
  expect(oracle.pragma('integrity_check', { simple: true })).toBe('ok');
  oracle.close();
  return { source, gz, lyricsId, others };
}

describe('rows only a loose reading of the tags could use', () => {
  const TYPO = { title: 'Lonely Rooad', artist: 'Band', album: 'Album', durationMs: 200_000 };
  const CHANNEL = { title: 'Real Singer - Their Song', artist: 'Channel', album: 'Channel', durationMs: 150_000 };
  const FILM = { title: 'Main Theme', artist: 'Big Film', album: 'Hits', durationMs: 170_000 };
  const LONGER_NAME = { title: 'Silent Hilll', artist: 'Big Band Orchestra', album: 'Hits', durationMs: 210_000 };

  function keptBy(rows) {
    const source = tempPath('loose.sqlite3');
    const dump = openDump(source);
    const ids = rows.map(({ row, lyrics = { plain: 'la' } }) => {
      const id = dump.addTrack(row);
      dump.addLyrics(id, lyrics);
      return id;
    });
    dump.finish();
    const gz = `${source}.gz`;
    gzipFile(source, gz);
    const library = tempPath('loose-library.db');
    writeLibrary(library, [TYPO, CHANNEL, FILM, LONGER_NAME]);
    const out = tempPath('loose-extract.db');
    expect(runExtract({ dump: gz, out, library }).status).toBe(0);

    const db = new Database(out, { readonly: true });
    const kept = new Map(
      db
        .prepare('SELECT id, credit_matched FROM dump_tracks')
        .all()
        .map((r) => [r.id, r.credit_matched]),
    );
    const read = db.prepare('SELECT track_id FROM dump_lyrics').pluck().all();
    db.close();
    return { outcomes: ids.map((id) => kept.get(id) ?? 'dropped'), read: read.length };
  }

  it('keeps and reads a title a little off, by the same artist at the same length', () => {
    const typoed = { name: 'Lonely Road', album: 'Elsewhere' };
    const { outcomes, read } = keptBy([
      { row: { ...typoed, artist: 'Band', duration: 200 } },
      { row: { ...typoed, artist: 'Band feat. Someone', duration: 201 } },
      { row: { ...typoed, artist: 'Band', duration: 202.5 } },
      { row: { ...typoed, artist: 'Someone Else', duration: 200 } },
      { row: { name: 'Unrelated Song', album: 'Elsewhere', artist: 'Band', duration: 200 } },
    ]);

    expect(outcomes).toEqual([1, 1, 'dropped', 'dropped', 'dropped']);
    expect(read).toBe(2);
  });

  it('takes the artist in either direction, whole words', () => {
    const typoed = { name: 'Silent Hill', album: 'Elsewhere', duration: 210 };
    const { outcomes, read } = keptBy([
      { row: { ...typoed, artist: 'Big Band' } },
      { row: { ...typoed, artist: 'The Big Band Orchestra Live' } },
      { row: { ...typoed, artist: 'Big Bands' } },
    ]);

    expect(outcomes).toEqual([1, 1, 'dropped']);
    expect(read).toBe(2);
  });

  it('keeps and reads the artist and title named in a title tag', () => {
    const named = { name: 'Their Song', album: 'Elsewhere', duration: 150 };
    const { outcomes, read } = keptBy([
      { row: { ...named, artist: 'Real Singer' } },
      { row: { ...named, artist: 'Someone Else' } },
      { row: { ...named, artist: 'Someone Else', duration: 170 } },
    ]);

    expect(outcomes).toEqual([1, 0, 'dropped']);
    expect(read).toBe(1);
  });

  it('reads a record on an album that names the artist tag', () => {
    const theme = { name: 'Main Theme', artist: 'Real Singer', duration: 170 };
    const { outcomes, read } = keptBy([
      { row: { ...theme, album: 'Big Film (Original Soundtrack)' } },
      { row: { ...theme, album: 'Elsewhere' } },
      { row: { ...theme, album: null } },
    ]);

    expect(outcomes).toEqual([1, 0, 0]);
    expect(read).toBe(1);
  });
});

describe('look-alikes', () => {
  it("doesn't let a row of another table stand in for a lyrics row with the same rowid", () => {
    const run = extractOf((path) => {
      const dump = openDump(path);
      const rowid = 7;
      const trackId = dump.addTrack({ id: 1, name: SONG.title, artist: SONG.artist, album: 'One', duration: 200 });
      const lyricsId = dump.addLyrics(trackId, { id: rowid, plain: 'the real one' });
      // Earlier in the file than the lyrics table, and it spills, so it isn't found out until it's whole.
      dump.addTrack({ id: rowid, name: 'Not lyrics '.repeat(1000), artist: null, duration: 100 });
      dump.finish();
      return { lyricsId };
    });
    expect(cellsWithRowid(run.source, run.expected.lyricsId).some(({ overflowPage }) => overflowPage > 0)).toBe(true);
    expect(run.meta.look_alikes).toBe(1);
    expect(run.meta.found).toBe(1);
    expectSameRows(run.source, 'lyrics', run.out, 'dump_lyrics', LYRICS_COLUMNS, [run.expected.lyricsId]);
  });
});

describe('overflow chains', () => {
  it('follows a chain that points backward, in a third pass that stops early', () => {
    const run = extractOf(buildBackwardChain);
    const { keptLyrics, keptTracks } = run.expected;

    expect([...keptLyrics].some((id) => goesBackward(chainOf(run.source, id)))).toBe(true);
    expect(run.meta.passes).toHaveLength(3);

    expectSameRows(run.source, 'tracks', run.out, 'dump_tracks', TRACK_COLUMNS, [...keptTracks.keys()]);
    expectSameRows(run.source, 'lyrics', run.out, 'dump_lyrics', LYRICS_COLUMNS, [...keptLyrics]);
    expect(run.meta.unreadable_ids).toEqual([]);
    expect(run.meta.not_found_ids).toEqual([]);

    const pageCount = parseHeader(readFileSync(run.source)).pageCount;
    const lastPass = run.meta.passes.at(-1);
    expect(lastPass.stoppedEarly).toBe(true);
    expect(lastPass.pagesRead).toBeLessThan(pageCount);
  });

  it('needs no third pass when every chain runs forward', () => {
    const run = extractOf((path) => {
      const dump = openDump(path);
      const trackId = dump.addTrack({ name: SONG.title, artist: SONG.artist, album: 'One', duration: 200 });
      const lyricsId = dump.addLyrics(trackId, { plain: 'f'.repeat(50_000) });
      dump.finish();
      return { lyricsId };
    });
    const { leafPage, chain } = chainOf(run.source, run.expected.lyricsId);
    expect(chain.length).toBeGreaterThan(5);
    expect(goesBackward({ leafPage, chain })).toBe(false);
    expect(run.meta.passes).toHaveLength(2);
    expect(run.meta.passes[1].stoppedEarly).toBe(true);
    expect(run.meta.found).toBe(1);
  });

  function buildDamagedChains(path) {
    const dump = openDump(path);
    dump.db.exec('BEGIN');
    const ids = {};
    for (const name of ['healthy', 'endsEarly', 'runsOn', 'loops', 'pastTheEnd', 'loopsToItself', 'jumper', 'jumpee']) {
      const trackId = dump.addTrack({ name: SONG.title, artist: SONG.artist, album: name, duration: 200 });
      ids[name] = dump.addLyrics(trackId, { plain: `${name} `.repeat(3000) });
    }
    dump.db.exec('COMMIT');
    dump.finish();
    return ids;
  }

  it.each([
    ['reversed', reversed],
    ['shuffled', shuffled],
  ])('reads a %s chain in three passes, however long it is', (_name, arrange) => {
    for (const overflowPages of [3, 300]) {
      const { source, gz, lyricsId } = dumpWithRearrangedChain(overflowPages, arrange);
      const out = tempPath('rearranged.db');
      expect(runExtract({ dump: gz, out }).status).toBe(0);

      const meta = readMeta(out);
      expect(meta.passes).toHaveLength(3);
      expect(meta.unreadable_ids).toEqual([]);
      expectSameRows(source, 'lyrics', out, 'dump_lyrics', LYRICS_COLUMNS, [lyricsId]);
    }
  });

  it('reports broken chains as unreadable, keeps the rest, and finishes', () => {
    const source = tempPath('damaged.sqlite3');
    const ids = buildDamagedChains(source);
    const { bytes, header } = pagesOf(source);
    const pageAt = (pageNumber) => (pageNumber - 1) * header.pageSize;
    const chains = Object.fromEntries(Object.entries(ids).map(([name, id]) => [name, chainOf(source, id).chain]));
    for (const chain of Object.values(chains)) expect(chain.length).toBeGreaterThan(2);

    const setNext = (pageNumber, next) => bytes.writeUInt32BE(next, pageAt(pageNumber));
    setNext(chains.endsEarly[0], 0);
    setNext(chains.runsOn.at(-1), 2);
    setNext(chains.loops[1], chains.loops[0]);
    setNext(chains.pastTheEnd[0], header.pageCount + 5);
    setNext(chains.loopsToItself[0], chains.loopsToItself[0]);
    setNext(chains.jumper[0], chains.jumpee[1]);

    const dump = `${source}.gz`;
    writeFileSync(dump, gzipSync(bytes, { level: 1 }));
    const out = tempPath('damaged.db');
    const result = runExtract({ dump, out });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);

    const meta = readMeta(out);
    const damaged = ['endsEarly', 'runsOn', 'loops', 'pastTheEnd', 'loopsToItself', 'jumper', 'jumpee'];
    expect(new Set(meta.unreadable_ids)).toEqual(new Set(damaged.map((name) => ids[name])));
    expect(meta.not_found_ids).toEqual([]);
    expect(meta.found).toBe(1);
    expect(meta.passes.length).toBeLessThanOrEqual(3);

    const oracle = new Database(source, { readonly: true });
    const healthy = oracle.prepare('SELECT plain_lyrics FROM lyrics WHERE id = ?').pluck().get(ids.healthy);
    oracle.close();
    const db = new Database(out, { readonly: true });
    expect(db.prepare('SELECT plain_lyrics FROM dump_lyrics').pluck().all()).toEqual([healthy]);
    db.close();
  });

  it('finds a break behind the page it has reached without another pass', () => {
    const source = tempPath('broken-backward.sqlite3');
    const dump = openDump(source);
    const trackId = dump.addTrack({ name: SONG.title, artist: SONG.artist, album: 'One', duration: 200 });
    const lyricsId = dump.addLyrics(trackId, { plain: 'r'.repeat(4 * 4092) });
    dump.finish();

    const { bytes, header } = pagesOf(source);
    const { chain } = chainOf(source, lyricsId);
    rearrangeChain(bytes, header, lyricsId, source, reversed);
    bytes.writeUInt32BE(0, (chain.at(-2) - 1) * header.pageSize);
    const gz = `${source}.gz`;
    writeFileSync(gz, gzipSync(bytes, { level: 1 }));

    const out = tempPath('broken-backward.db');
    expect(runExtract({ dump: gz, out }).status).toBe(0);
    const meta = readMeta(out);
    expect(meta.unreadable_ids).toEqual([lyricsId]);
    expect(meta.found).toBe(0);
    expect(meta.passes).toHaveLength(2);
  });

  it('takes back a kept row when another chain turns out to share its page', () => {
    const source = tempPath('cross-linked.sqlite3');
    const dump = openDump(source);
    dump.addLyricsColumn();
    dump.addLyricsColumn();
    dump.addLyricsColumn();
    dump.db.exec('BEGIN');
    // Three overflow pages and the smallest local part, so a leaf holds several rows, and most of them come before their chains.
    const payloadSize = 489 + 3 * 4092;
    const ids = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((album) => {
      const trackId = dump.addTrack({ name: SONG.title, artist: SONG.artist, album, duration: 200 });
      const lyricsfile = `${album} lyricsfile `.repeat(400);
      return dump.addLyricsOfPayload(trackId, payloadSize, { lyricsfile, hasLyricsfile: 1 });
    });
    dump.db.exec('COMMIT');
    dump.finish();

    const rows = ids.map((id) => ({ id, ...chainOf(source, id) }));
    const first = rows.find((row) => !goesBackward(row));
    const second = rows.find(({ chain }) => chain[0] > first.chain.at(-1));

    // A read finishes and keeps the first row, on the second's last page, before the second's chain, stepping backward,
    // gets there. Only the first's lyricsfile is wrong, and that comes after track_id, so nothing about it looks wrong.
    const { bytes, header } = pagesOf(source);
    rearrangeChain(bytes, header, second.id, source, reversed);
    bytes.writeUInt32BE(second.chain[0], (first.chain.at(-2) - 1) * header.pageSize);
    const gz = `${source}.gz`;
    writeFileSync(gz, gzipSync(bytes, { level: 1 }));

    const out = tempPath('cross-linked.db');
    const result = runExtract({ dump: gz, out });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);

    const meta = readMeta(out);
    expect(new Set(meta.unreadable_ids)).toEqual(new Set([first.id, second.id]));
    expect(meta.not_found_ids).toEqual([]);
    expect(meta.found).toBe(ids.length - 2);
    const others = ids.filter((id) => id !== first.id && id !== second.id);
    expect([...snapshotOf(out, 'dump_lyrics', LYRICS_COLUMNS).keys()]).toEqual(others);
  });
});

describe('a tracks row too long to read', () => {
  const LONG_ALBUM = 'A very long album name '.repeat(250);

  it('says whether its title is in the library', () => {
    const run = extractOf((path) => {
      const dump = openDump(path);
      const addWithLyrics = (track) => {
        const trackId = dump.addTrack({ artist: SONG.artist, duration: 200, ...track });
        dump.addLyrics(trackId, { plain: 'la' });
        return trackId;
      };
      const hit = addWithLyrics({ name: SONG.title, album: LONG_ALBUM });
      addWithLyrics({ name: 'Not In The Library', album: LONG_ALBUM });
      addWithLyrics({ name: `${SONG.title} ${'long '.repeat(2000)}` });
      dump.finish();
      return { hit };
    });
    expect(run.meta.tracks_rows_too_long).toBe(3);
    expect(run.meta.too_long_title_hits).toEqual([{ id: run.expected.hit, name: SONG.title }]);
    expect(run.meta.rows_kept).toBe(0);
    expect(run.stdout).toContain('Rows too long to read, with a title in the library');
  });

  it('says it never checked, for an extract scanned before it could', () => {
    const run = extractOf(smallDump);
    const earlier = new Database(run.out);
    earlier.exec("DELETE FROM meta WHERE key = 'too_long_title_hits'");
    earlier.close();

    const rerun = runExtract({ dump: run.dump, out: run.out });
    expect(rerun.status).toBe(0);
    expect(rerun.stdout).toMatch(/with a title in the library\s*.\s*'not checked'/);
  });
});

function smallDump(path) {
  const dump = openDump(path);
  dump.db.exec('BEGIN');
  const keptLyrics = [];
  for (let i = 0; i < 30; i += 1) {
    const trackId = dump.addTrack({ name: SONG.title, artist: SONG.artist, album: `Album ${i}`, duration: 200 });
    keptLyrics.push(dump.addLyrics(trackId, { plain: `${i} `.repeat(i * 300), synced: '[00:01.00] la' }));
  }
  for (let i = 0; i < 500; i += 1) {
    const trackId = dump.addTrack({ name: `Noise ${i}`, artist: 'Nobody', album: 'None', duration: 100 });
    dump.addLyrics(trackId, { plain: `${i} `.repeat(200) });
  }
  dump.db.exec('COMMIT');
  dump.finish();
  return { keptLyrics };
}

describe('running it again', () => {
  it('skips a finished tracks scan, and reads only the lyrics it lacks', () => {
    const run = extractOf(smallDump);
    const first = snapshotOf(run.out, 'dump_lyrics', LYRICS_COLUMNS);
    const tracksBefore = snapshotOf(run.out, 'dump_tracks', TRACK_COLUMNS);
    expect(first.size).toBe(30);

    const interrupted = new Database(run.out);
    const passesBefore = readMeta(run.out).passes;
    interrupted.exec(`
      DELETE FROM dump_lyrics WHERE id % 2 = 0;
      DELETE FROM meta WHERE key = 'lyrics_scan_finished_at';
    `);
    interrupted.prepare("UPDATE meta SET value = ? WHERE key = 'passes'").run(JSON.stringify(passesBefore.slice(0, 1)));
    interrupted.close();

    const rerun = runExtract({ dump: run.dump, out: run.out });
    expect(rerun.stderr).toBe('');
    expect(rerun.status).toBe(0);
    expect(rerun.stdout).toContain("so it's skipped");

    const meta = readMeta(run.out);
    expect(meta.passes[0]).toEqual(passesBefore[0]);
    expect(meta.passes.length).toBeGreaterThanOrEqual(2);
    expect(snapshotOf(run.out, 'dump_lyrics', LYRICS_COLUMNS)).toEqual(first);
    expect(snapshotOf(run.out, 'dump_tracks', TRACK_COLUMNS)).toEqual(tracksBefore);
  });

  it('reads nothing when every wanted row is already there', () => {
    const run = extractOf(smallDump);
    const interrupted = new Database(run.out);
    interrupted.exec("DELETE FROM meta WHERE key = 'lyrics_scan_finished_at'");
    interrupted
      .prepare("UPDATE meta SET value = ? WHERE key = 'passes'")
      .run(JSON.stringify(run.meta.passes.slice(0, 1)));
    interrupted.close();

    const rerun = runExtract({ dump: run.dump, out: run.out });
    expect(rerun.status).toBe(0);
    expect(readMeta(run.out).passes).toEqual(run.meta.passes.slice(0, 1));
    expect(readMeta(run.out).found).toBe(30);
  });

  it('reads nothing when the extract is already finished', () => {
    const run = extractOf(smallDump);
    const rerun = runExtract({ dump: run.dump, out: run.out });
    expect(rerun.status).toBe(0);
    expect(rerun.stdout).toContain("so it's skipped");
    expect(readMeta(run.out)).toEqual(run.meta);
  });

  it('keeps what earlier passes found when a later pass dies, and finishes the rest', () => {
    const { source, gz, lyricsId, others } = dumpWithRearrangedChain(10, reversed, (dump) =>
      Array.from({ length: 50 }, (_, i) => {
        const trackId = dump.addTrack({ name: SONG.title, artist: SONG.artist, album: `Album ${i}`, duration: 200 });
        return dump.addLyrics(trackId, { plain: `${i} `.repeat(300) });
      }),
    );
    const out = tempPath('dies-late.db');

    const dying = runExtractFailingOnRead(4, { dump: gz, out });
    expect(dying.status).not.toBe(0);
    expect(dying.stderr).toContain('no such file');

    expect([...snapshotOf(out, 'dump_lyrics', LYRICS_COLUMNS).keys()]).toEqual(others);
    const afterDying = readMeta(out);
    expect(afterDying.passes).toHaveLength(2);
    expect(afterDying.lyrics_scan_finished_at).toBeUndefined();

    expect(runExtract({ dump: gz, out }).status).toBe(0);
    const meta = readMeta(out);
    expect(meta.passes).toHaveLength(4);
    expect(meta.passes[0]).toEqual(afterDying.passes[0]);
    expect(meta.unreadable_ids).toEqual([]);
    expectSameRows(source, 'lyrics', out, 'dump_lyrics', LYRICS_COLUMNS, [...others, lyricsId]);
  });

  it('keeps hashing a library the same way, or every finished extract would look like a different library', () => {
    const run = extractOf(smallDump);
    const scanned = LIBRARY.map(({ title, artist, durationMs }) => [title, artist, durationMs]);
    expect(run.meta.inputs.library).toBe(createHash('sha256').update(JSON.stringify(scanned)).digest('hex'));
  });

  it('refuses a finished scan of a different library', () => {
    const run = extractOf(smallDump);
    const library = tempPath('other-library.db');
    writeLibrary(library, [{ ...SONG, title: 'Another Song' }]);
    const rerun = runExtract({ dump: run.dump, out: run.out, library });
    expect(rerun.status).not.toBe(0);
    expect(rerun.stderr).toContain('different dump or library');
    expect(readMeta(run.out)).toEqual(run.meta);
  });

  it('starts an unfinished tracks scan over', () => {
    const run = extractOf(smallDump);
    const before = snapshotOf(run.out, 'dump_tracks', TRACK_COLUMNS);
    const interrupted = new Database(run.out);
    interrupted.exec(`
      DELETE FROM meta;
      DELETE FROM dump_lyrics;
      INSERT INTO dump_tracks (id, name, artist_name, duration, last_lyrics_id, credit_matched)
      VALUES (123456, 'left behind', 'by a crash', 1, 1, 1);
    `);
    interrupted.close();

    const rerun = runExtract({ dump: run.dump, out: run.out });
    expect(rerun.status).toBe(0);
    expect(rerun.stdout).not.toContain("so it's skipped");
    expect(snapshotOf(run.out, 'dump_tracks', TRACK_COLUMNS)).toEqual(before);
    expect(readMeta(run.out).found).toBe(30);
  });
});

describe('a bad dump', () => {
  function expectLoudFailure(dump, message) {
    const out = tempPath('failed.db');
    const result = runExtract({ dump, out });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);
    const db = new Database(out, { readonly: true });
    const finished = db.prepare("SELECT COUNT(*) FROM meta WHERE key LIKE '%finished_at'").pluck().get();
    db.close();
    expect(finished).toBe(0);
  }

  function dumpBytes() {
    const source = tempPath('bad.sqlite3');
    smallDump(source);
    return { source, gz: gzipSync(readFileSync(source), { level: 1 }) };
  }

  it('fails on a truncated file', () => {
    const { gz } = dumpBytes();
    const dump = tempPath('truncated.gz');
    writeFileSync(dump, gz.subarray(0, gz.length - 1000));
    expectLoudFailure(dump, 'is truncated or corrupt');
  });

  it('fails on a corrupt file', () => {
    const { gz } = dumpBytes();
    const middle = Math.floor(gz.length / 2);
    gz.fill(0x55, middle, middle + 64);
    const dump = tempPath('corrupt.gz');
    writeFileSync(dump, gz);
    expectLoudFailure(dump, 'is truncated or corrupt');
  });

  it('fails on a stream that stops short of the pages it promises', () => {
    const { source } = dumpBytes();
    const dump = tempPath('short.gz');
    writeFileSync(dump, gzipSync(readFileSync(source).subarray(0, 4096 * 50), { level: 1 }));
    expectLoudFailure(dump, 'but its header promises');
  });

  it('refuses a file with free pages before reading it', () => {
    const source = tempPath('free-pages.sqlite3');
    const db = new Database(source);
    db.exec('CREATE TABLE t (a); INSERT INTO t VALUES (zeroblob(50000)); DELETE FROM t');
    db.close();
    const dump = `${source}.gz`;
    gzipFile(source, dump);
    const out = tempPath('free-pages.db');
    const result = runExtract({ dump, out });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('free pages');
    rmSync(out, { force: true });
  });
});

describe('match.mjs', () => {
  const WORDS = 'la '.repeat(20).trim();
  const SYNCED = `[00:01.00] ${WORDS}`;
  const TRACKS = {
    exact: { title: 'Exact', artist: 'Band', album: 'Album', durationMs: 200_000 },
    otherAlbum: { title: 'Other Album', artist: 'Band', album: 'Album', durationMs: 200_000 },
    feat: { title: 'Feat', artist: 'Band', album: 'Album', durationMs: 200_000 },
    remaster: { title: 'Remaster', artist: 'Band', album: 'Album', durationMs: 200_000 },
    plain: { title: 'Plain', artist: 'Band', album: 'Album', durationMs: 200_000 },
    instrumental: { title: 'Instrumental One', artist: 'Band', album: 'Album', durationMs: 200_000 },
    wrongArtist: { title: 'Wrong Artist', artist: 'Band', album: 'Album', durationMs: 200_000 },
    sameAlbum: { title: 'Same Album', artist: 'Film', album: 'Film', durationMs: 200_000 },
    tooFewWords: { title: 'Too Few Words', artist: 'Band', album: 'Album', durationMs: 200_000 },
    slightlyOff: { title: 'Slightly Off', artist: 'Band', album: 'Album', durationMs: 200_000 },
    furtherOff: { title: 'Further Off', artist: 'Band', album: 'Album', durationMs: 200_000 },
    tooFar: { title: 'Too Far', artist: 'Band', album: 'Album', durationMs: 200_000 },
    tooLate: { title: 'Too Late', artist: 'Band', album: 'Album', durationMs: 200_000 },
    prefersSynced: { title: 'Prefers Synced', artist: 'Band', album: 'Album', durationMs: 200_000 },
    noVocals: { title: 'No Vocals', artist: 'Band', album: 'Album (Instrumental Version)', durationMs: 200_000 },
    noAlbum: { title: 'No Album', artist: 'Band', album: 'Album', durationMs: 200_000 },
    absent: { title: 'Absent', artist: 'Band', album: 'Album', durationMs: 200_000 },
    tooShort: { title: 'Too Short', artist: 'Band', album: 'Album', durationMs: 200_000 },
    typo: { title: 'Lonely Rooad', artist: 'Band', album: 'Album', durationMs: 200_000 },
    typoFlagged: { title: 'Quiet Rooad', artist: 'Band', album: 'Album', durationMs: 200_000 },
    upload: { title: 'Real Singer - Their Song', artist: 'Channel', album: 'Channel', durationMs: 200_000 },
    filmTheme: { title: 'Main Theme', artist: 'Big Film', album: 'Hits', durationMs: 200_000 },
    dressed: { title: 'Dressed (Live)', artist: 'Band', album: 'Album', durationMs: 200_000 },
    twin: { title: 'Twin', artist: 'Band', album: 'Album', durationMs: 200_000 },
    twinLive: { title: 'Twin (Live)', artist: 'Band', album: 'Album', durationMs: 200_000 },
    baseOnly: { title: 'Base Only', artist: 'Band', album: 'Album', durationMs: 200_000 },
    dedupe: { title: 'Dedupe (Live)', artist: 'Band', album: 'Album', durationMs: 200_000 },
    firstOfTwo: { title: 'Shared Title', artist: 'First Band', album: 'First', durationMs: 200_000 },
    secondOfTwo: { title: 'Shared Title', artist: 'Second Band', album: 'Second', durationMs: 200_000 },
  };

  it("picks each track's lyrics from the extract by lrclib.ts's rules", () => {
    const source = tempPath('match.sqlite3');
    const dump = openDump(source);
    const add = (track, overrides, lyrics) => {
      const trackId = dump.addTrack({
        name: track.title,
        artist: track.artist,
        album: track.album,
        duration: track.durationMs / 1000,
        ...overrides,
      });
      dump.addLyrics(trackId, lyrics);
    };
    const both = { plain: WORDS, synced: SYNCED };
    add(TRACKS.exact, {}, both);
    add(TRACKS.otherAlbum, { album: 'Some Other Album', duration: 201 }, both);
    add(TRACKS.feat, { artist: 'Band feat. Someone Else' }, both);
    add(TRACKS.remaster, { name: 'Remaster (Remastered 2011)' }, both);
    add(TRACKS.plain, {}, { plain: WORDS });
    add(TRACKS.instrumental, {}, { instrumental: 1 });
    add(TRACKS.wrongArtist, { artist: 'Someone Unrelated', album: 'Elsewhere' }, both);
    add(TRACKS.sameAlbum, { artist: 'Real Singer', album: 'Film (Original Soundtrack)' }, both);
    add(TRACKS.tooFewWords, {}, { plain: 'la la la', synced: '[00:01.00] la la la' });
    add(TRACKS.slightlyOff, { duration: 204 }, both);
    add(TRACKS.furtherOff, { duration: 210 }, both);
    add(TRACKS.tooFar, { duration: 215.5 }, both);
    add(TRACKS.tooLate, {}, { synced: `[59:00.00] ${WORDS}` });
    add(TRACKS.prefersSynced, {}, { plain: WORDS });
    add(TRACKS.prefersSynced, { album: 'Some Other Album' }, both);
    add(TRACKS.noVocals, {}, both);
    add(TRACKS.noAlbum, { album: null }, both);
    add(TRACKS.tooShort, { duration: 139 }, both);
    add(TRACKS.typo, { name: 'Lonely Road' }, both);
    add(TRACKS.typoFlagged, { name: 'Quiet Road' }, { instrumental: 1 });
    add(TRACKS.upload, { name: 'Their Song', artist: 'Real Singer', album: 'Elsewhere' }, both);
    add(TRACKS.filmTheme, { artist: 'Real Singer', album: 'Big Film (Original Soundtrack)' }, both);
    add(TRACKS.dressed, { name: 'Dressed Live', artist: 'Real Singer' }, both);
    add(TRACKS.baseOnly, { name: 'Base Only (Live)', artist: 'Real Singer' }, both);
    add(TRACKS.dedupe, { name: 'Dedupe' }, both);
    for (const copy of [1, 2, 3, 4, 5, 6]) add(TRACKS.dedupe, { album: `Copy ${copy}` }, { instrumental: 1 });
    add(TRACKS.twinLive, {}, both);
    add(TRACKS.secondOfTwo, { album: 'Elsewhere' }, both);
    dump.finish();

    const library = tempPath('match-library.db');
    writeLibrary(library, Object.values(TRACKS));
    const gz = `${source}.gz`;
    gzipFile(source, gz);
    const extract = tempPath('match-extract.db');
    expect(runExtract({ dump: gz, out: extract, library }).status).toBe(0);

    const out = tempPath('nested/lyrics.db');
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = runMatch({ extract, library, out });
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
    }

    const db = new Database(out, { readonly: true });
    const rows = db
      .prepare('SELECT title, status, matched_via, synced_lrc, plain_text, lrclib_album FROM lyrics')
      .all();
    db.close();
    const byTitle = Object.fromEntries(rows.map((row) => [row.title, row]));
    const answer = (track) => {
      const row = byTitle[track.title];
      return [row?.status, row?.matched_via, row?.synced_lrc];
    };
    expect(rows).toHaveLength(Object.keys(TRACKS).length);
    expect(answer(TRACKS.exact)).toEqual(['found', 'exact', SYNCED]);
    expect(answer(TRACKS.otherAlbum)).toEqual(['found', 'any_album', SYNCED]);
    expect(answer(TRACKS.feat)).toEqual(['found', 'search', SYNCED]);
    expect(answer(TRACKS.remaster)).toEqual(['found', 'search', SYNCED]);
    expect(answer(TRACKS.plain)).toEqual(['found', 'exact', null]);
    expect(answer(TRACKS.instrumental)).toEqual(['instrumental', 'exact', null]);
    expect(answer(TRACKS.wrongArtist)).toEqual(['not_found', null, null]);
    expect(answer(TRACKS.sameAlbum)).toEqual(['found', 'same_album', SYNCED]);
    expect(answer(TRACKS.tooFewWords)).toEqual(['not_found', null, null]);
    expect(answer(TRACKS.slightlyOff)).toEqual(['found', 'exact', SYNCED]);
    expect(answer(TRACKS.furtherOff)).toEqual(['found', 'exact', null]);
    expect(answer(TRACKS.tooFar)).toEqual(['found', 'loose', null]);
    expect(answer(TRACKS.tooLate)).toEqual(['not_found', null, null]);
    expect(answer(TRACKS.prefersSynced)).toEqual(['found', 'any_album', SYNCED]);
    expect(answer(TRACKS.noVocals)).toEqual(['instrumental', 'exact', null]);
    expect(answer(TRACKS.noAlbum)).toEqual(['found', 'any_album', SYNCED]);
    expect(answer(TRACKS.absent)).toEqual(['not_found', null, null]);
    expect(answer(TRACKS.tooShort)).toEqual(['not_found', null, null]);
    expect(answer(TRACKS.typo)).toEqual(['found', 'loose', SYNCED]);
    expect(answer(TRACKS.typoFlagged)).toEqual(['not_found', null, null]);
    expect(answer(TRACKS.upload)).toEqual(['found', 'loose', SYNCED]);
    expect(answer(TRACKS.filmTheme)).toEqual(['found', 'loose', SYNCED]);
    expect(answer(TRACKS.dressed)).toEqual(['found', 'same_album', SYNCED]);
    expect(answer(TRACKS.baseOnly)).toEqual(['found', 'same_album', SYNCED]);
    expect(answer(TRACKS.dedupe)).toEqual(['found', 'search', SYNCED]);
    expect(answer(TRACKS.twin)).toEqual(['found', 'search', SYNCED]);
    expect(answer(TRACKS.twinLive)).toEqual(['found', 'exact', SYNCED]);
    const byArtistOfTitle = Object.fromEntries(
      rows.filter(({ title }) => title === 'Shared Title').map(({ lrclib_album: album, status }) => [status, album]),
    );
    expect(byArtistOfTitle).toEqual({ found: 'Elsewhere', not_found: null });
  });

  it('refuses an extract that was never finished', () => {
    const extract = tempPath('unfinished.db');
    const db = new Database(extract);
    db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.close();
    const result = runMatch({ extract });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("isn't finished");
  });

  it('refuses a library the extract was not scanned from', () => {
    const run = extractOf(smallDump);
    const library = tempPath('grown-library.db');
    writeLibrary(library, [...LIBRARY, { ...SONG, title: 'Added Later' }]);

    const refused = runMatch({ extract: run.out, library });
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain('different library');

    expect(runMatch({ extract: run.out }).status).toBe(0);
  });

  describe('a record that matches a track, with no lyrics in the extract', () => {
    const READABLE = { title: 'Readable', artist: 'Band', album: 'Album', durationMs: 200_000 };
    const DANGLING = { title: 'Dangling', artist: 'Band', album: 'Album', durationMs: 200_000 };
    const DAMAGED = { title: 'Damaged', artist: 'Band', album: 'Album', durationMs: 200_000 };

    function extractWithEveryReason() {
      const source = tempPath('reasons.sqlite3');
      const dump = openDump(source);
      const add = ({ title, artist, album, durationMs }, lyrics) => {
        const trackId = dump.addTrack({ name: title, artist, album, duration: durationMs / 1000 });
        return { trackId, lyricsId: dump.addLyrics(trackId, lyrics) };
      };
      const readable = add(READABLE, { plain: WORDS, synced: SYNCED });
      const dangling = add(DANGLING, { plain: 'la' });
      dump.db.prepare('UPDATE tracks SET last_lyrics_id = 999999 WHERE id = ?').run(dangling.trackId);
      const damaged = add(DAMAGED, { plain: 'd'.repeat(20_000) });
      dump.finish();

      const { bytes, header } = pagesOf(source);
      bytes.writeUInt32BE(0, (chainOf(source, damaged.lyricsId).chain[0] - 1) * header.pageSize);
      const gz = `${source}.gz`;
      writeFileSync(gz, gzipSync(bytes, { level: 1 }));

      const library = tempPath('reasons-library.db');
      writeLibrary(library, [READABLE, DANGLING, DAMAGED]);
      const out = tempPath('reasons.db');
      expect(runExtract({ dump: gz, out, library }).status).toBe(0);
      return { gz, library, out, readable };
    }

    function statusesOf(path) {
      const db = new Database(path, { readonly: true });
      const rows = db.prepare('SELECT title, status FROM lyrics').all();
      db.close();
      return Object.fromEntries(rows.map(({ title, status }) => [title, status]));
    }

    /** What an extract looks like if an older rule turned this row down, and today's accepts it. */
    function forgetCreditMatch(path, { trackId, lyricsId }) {
      const db = new Database(path);
      db.prepare('UPDATE dump_tracks SET credit_matched = 0 WHERE id = ?').run(trackId);
      db.prepare('DELETE FROM dump_lyrics WHERE id = ?').run(lyricsId);
      db.close();
    }

    it('counts unreadable rows and rows the dump lacks', () => {
      const { library, out } = extractWithEveryReason();
      const lyrics = tempPath('reasons-lyrics.db');
      const result = runMatch({ extract: out, library, out: lyrics });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        'no lyrics in the extract: 1 unreadable, 1 not found in the dump, 0 not read yet',
      );
      expect(result.stdout).not.toContain('run extract.mjs again');
      expect(statusesOf(lyrics)).toEqual({ Readable: 'found', Dangling: 'not_found', Damaged: 'not_found' });
    });

    it('says so when a rule now accepts a row that was never read, and a rerun of extract.mjs reads just that', () => {
      const { gz, library, out, readable } = extractWithEveryReason();
      forgetCreditMatch(out, readable);
      const before = readMeta(out);

      const lyrics = tempPath('loosened-lyrics.db');
      const notRead = runMatch({ extract: out, library, out: lyrics });
      expect(notRead.status).toBe(0);
      expect(notRead.stdout).toContain('1 not read yet');
      expect(notRead.stdout).toContain('run extract.mjs again');
      expect(statusesOf(lyrics).Readable).toBe('not_found');

      const rerun = runExtract({ dump: gz, out, library });
      expect(rerun.stderr).toBe('');
      expect(rerun.status).toBe(0);
      expect(rerun.stdout).toContain("so it's skipped");
      expect(rerun.stdout).toContain('Rows whose credit match changed since the last run: 1');

      const meta = readMeta(out);
      expect(meta.passes).toHaveLength(before.passes.length + 1);
      expect(meta.found).toBe(before.found);
      expect(meta.unreadable_ids).toEqual(before.unreadable_ids);
      expect(meta.not_found_ids).toEqual(before.not_found_ids);

      const answered = runMatch({ extract: out, library, out: lyrics });
      expect(answered.status).toBe(0);
      expect(answered.stdout).toContain('1 unreadable, 1 not found in the dump, 0 not read yet');
      expect(statusesOf(lyrics).Readable).toBe('found');
    });

    it('turns on a row credited only by its album when a rerun finds the rule accepts it', () => {
      const THEME = { title: 'Main Theme', artist: 'Big Film', album: 'Big Film', durationMs: 200_000 };
      const source = tempPath('album-credit.sqlite3');
      const dump = openDump(source);
      const trackId = dump.addTrack({
        name: THEME.title,
        artist: 'Real Singer',
        album: 'Big Film (Original Soundtrack)',
        duration: 200,
      });
      const lyricsId = dump.addLyrics(trackId, { plain: WORDS, synced: SYNCED });
      dump.finish();
      const gz = `${source}.gz`;
      gzipFile(source, gz);
      const library = tempPath('album-credit-library.db');
      writeLibrary(library, [THEME]);
      const out = tempPath('album-credit.db');
      expect(runExtract({ dump: gz, out, library }).status).toBe(0);
      forgetCreditMatch(out, { trackId, lyricsId });

      const rerun = runExtract({ dump: gz, out, library });
      expect(rerun.stdout).toContain('Rows whose credit match changed since the last run: 1');

      const lyrics = tempPath('album-credit-lyrics.db');
      expect(runMatch({ extract: out, library, out: lyrics }).status).toBe(0);
      expect(statusesOf(lyrics)['Main Theme']).toBe('found');
    });

    it('turns off a row no rule accepts any more, keeping what it read', () => {
      const { gz, library, out, readable } = extractWithEveryReason();
      const db = new Database(out);
      db.prepare("UPDATE dump_tracks SET artist_name = 'Someone Else', album_name = 'Elsewhere' WHERE id = ?").run(
        readable.trackId,
      );
      db.close();

      expect(runExtract({ dump: gz, out, library }).stdout).toContain(
        'Rows whose credit match changed since the last run: 1',
      );
      const check = new Database(out, { readonly: true });
      const row = check.prepare('SELECT credit_matched FROM dump_tracks WHERE id = ?').get(readable.trackId);
      const kept = check.prepare('SELECT COUNT(*) FROM dump_lyrics WHERE id = ?').pluck().get(readable.lyricsId);
      check.close();
      expect(row.credit_matched).toBe(0);
      expect(kept).toBe(1);
    });

    it("doesn't read the dump again for rows it already knows it can't get", () => {
      const { gz, library, out } = extractWithEveryReason();
      const before = readMeta(out);
      expect(runExtract({ dump: gz, out, library }).status).toBe(0);
      expect(readMeta(out)).toEqual(before);
    });
  });
});
