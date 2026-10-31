/*
 * Turns LRCLIB's gzipped database dump into a small SQLite file holding only what could match a library.db. The dump is
 * too big to unpack and each read of it takes about eight minutes, so a rerun skips a finished tracks scan and keeps the
 * lyrics it already has.
 *
 * Pass 1 reads the tracks rows. Pass 2 reads the lyrics rows they point at. Pass 3 reads the overflow pages that went by
 * before their row did. It prints counts and metadata only: lyrics are copyrighted.
 *
 * What a change to lrclib.ts's rules takes: tightening one takes only match.mjs. Accepting more artists or albums takes a
 * rerun of this, which reads just their lyrics. Accepting other titles or lengths takes a new tracks scan: delete the
 * extract.
 */
import { mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import Database from 'better-sqlite3';
import {
  fitsLyricsTable,
  fitsSequenceTable,
  fitsStat1Table,
  fitsTracksTable,
  hasMatchableFields,
  readLyricsRow,
  STAT1_FIELDS,
  TRACK_FIELDS,
} from './dumpRows.mjs';
import {
  hashOfLibrary,
  indexLibrary,
  lrclib,
  readLibraryTracks,
  tracksToCheck,
  tracksWithTitle,
} from './libraryTracks.mjs';
import { createOverflowChains } from './overflowChains.mjs';
import {
  createRecord,
  forEachTableCell,
  isFieldLocal,
  isTableLeafPage,
  parseCellRecord,
  parseWholeRecord,
  readField,
  readHeader,
  STOP,
  streamPages,
} from './sqlitePages.mjs';

const GIB = 2 ** 30;
const PROGRESS_EVERY_BYTES = 10 * GIB;
const COMMIT_EVERY_ROWS = 1000;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS dump_tracks (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    artist_name TEXT NOT NULL,
    album_name TEXT,
    duration FLOAT NOT NULL,
    last_lyrics_id INTEGER NOT NULL,
    credit_matched INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS dump_lyrics (
    id INTEGER PRIMARY KEY,
    track_id INTEGER,
    plain_lyrics TEXT,
    synced_lyrics TEXT,
    has_plain_lyrics BOOLEAN,
    has_synced_lyrics BOOLEAN,
    instrumental BOOLEAN,
    source TEXT,
    created_at DATETIME,
    updated_at DATETIME,
    lyricsfile TEXT,
    has_lyricsfile BOOLEAN,
    has_word_sync BOOLEAN
  );
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

const { values: args } = parseArgs({
  options: {
    library: { type: 'string' },
    dump: { type: 'string' },
    out: { type: 'string' },
  },
});

if (args.library === undefined || args.dump === undefined || args.out === undefined) {
  console.error(
    'Usage: node scripts/lyrics-dump/extract.mjs --library <library.db> --dump <dump.sqlite3.gz> --out <extract.db>',
  );
  process.exit(1);
}

const header = await readHeader(args.dump);
const libraryTracks = readLibraryTracks(args.library);
const index = indexLibrary(libraryTracks);
console.log(`${libraryTracks.length} tracks in the library`);

mkdirSync(dirname(args.out), { recursive: true });
const out = new Database(args.out);
out.pragma('journal_mode = WAL');
out.pragma('synchronous = NORMAL');
out.exec(SCHEMA);

function writeMeta(values) {
  const save = out.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(values)) save.run(key, JSON.stringify(value));
}

function readMeta() {
  const rows = out.prepare('SELECT key, value FROM meta').all();
  return Object.fromEntries(rows.map(({ key, value }) => [key, JSON.parse(value)]));
}

// A finished tracks scan only answers for the dump and library it was run against.
function inputsOf() {
  return {
    dumpBytes: statSync(args.dump).size,
    pageCount: header.pageCount,
    library: hashOfLibrary(libraryTracks),
  };
}

function hasTrackNear(name, duration) {
  return tracksWithTitle(index.byTitle, name).some(
    (track) => Math.abs(duration - track.durationMs / 1000) <= lrclib.WIDEST_DURATION_SECONDS,
  );
}

function someTrackMayUse(tracks, name, artist, album, duration) {
  const record = { trackName: name, artistName: artist, albumName: album ?? '', duration };
  return tracks.some((track) => lrclib.mayAnswer(track, record));
}

function printCompletenessCheck({ tracks_rows_seen, lyrics_rows_seen, rows_at_last_analyze, sqlite_sequence }) {
  console.log(
    'Rows seen, beside the row count at the last ANALYZE (sqlite_stat1) and the highest id ever (sqlite_sequence):',
  );
  console.table({
    tracks: { seen: tracks_rows_seen, analyzed: rows_at_last_analyze.tracks, highestId: sqlite_sequence.tracks },
    lyrics: { seen: lyrics_rows_seen, analyzed: rows_at_last_analyze.lyrics, highestId: sqlite_sequence.lyrics },
  });
}

function startBatches() {
  let rows = 0;
  const commit = () => out.exec('COMMIT; BEGIN');
  out.exec('BEGIN');
  return {
    rowWritten() {
      rows += 1;
      if (rows % COMMIT_EVERY_ROWS === 0) commit();
    },
    commit,
    finish() {
      out.exec('COMMIT');
    },
  };
}

async function runPass(passes, describeProgress, onPage) {
  const pass = passes.length + 1;
  const progressEveryPages = Math.round(PROGRESS_EVERY_BYTES / header.pageSize);
  const startedAt = Date.now();
  const { pagesRead, stoppedEarly } = await streamPages(args.dump, header, (page, pageNumber) => {
    if (pageNumber % progressEveryPages === 0) {
      const gib = Math.round((pageNumber * header.pageSize) / GIB);
      console.log(`Pass ${pass}: ${gib} GiB, ${describeProgress()}`);
    }
    return onPage(page, pageNumber);
  });
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  passes.push({ pass, seconds, pagesRead, stoppedEarly });
  console.log(`Pass ${pass} done in ${seconds} s: ${describeProgress()}`);
}

async function scanTracks(inputs) {
  const cellRecord = createRecord();
  const firstByteCounts = new Array(256).fill(0);
  const sqliteSequence = {};
  const rowsAtLastAnalyze = {};
  const tooLongTitleHits = [];
  const counts = {
    tracks_rows_seen: 0,
    lyrics_rows_seen: 0,
    tracks_rows_too_long: 0,
    duplicate_track_rowids: 0,
    unreadable_cells: 0,
    malformed_records: 0,
  };
  let rowsKept = 0;

  out.exec('DELETE FROM dump_tracks; DELETE FROM dump_lyrics; DELETE FROM meta');
  const insert = out.prepare(
    `INSERT INTO dump_tracks (id, name, artist_name, album_name, duration, last_lyrics_id, credit_matched)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
  );
  const batches = startBatches();

  const keepIfCandidate = (record, rowid) => {
    const name = readField(record, TRACK_FIELDS.name);
    const artist = readField(record, TRACK_FIELDS.artistName);
    const duration = Number(readField(record, TRACK_FIELDS.duration));
    const tracks = tracksToCheck(index, { trackName: name, artistName: artist, duration });
    if (tracks.length === 0) return;

    const album = readField(record, TRACK_FIELDS.albumName);
    const creditMatched = someTrackMayUse(tracks, name, artist, album, duration) ? 1 : 0;
    if (creditMatched === 0 && !hasTrackNear(name, duration)) return;
    const lastLyricsId = readField(record, TRACK_FIELDS.lastLyricsId);
    const { changes } = insert.run(rowid, name, artist, album, duration, lastLyricsId, creditMatched);
    if (changes === 0) {
      counts.duplicate_track_rowids += 1;
      return;
    }
    rowsKept += 1;
    batches.rowWritten();
  };

  // The row can't be kept without its last_lyrics_id, but this shows whether it would have mattered.
  const noteTooLong = (record, rowid) => {
    counts.tracks_rows_too_long += 1;
    if (!isFieldLocal(record, TRACK_FIELDS.name)) return;
    const name = readField(record, TRACK_FIELDS.name);
    if (tracksWithTitle(index.byTitle, name).length > 0) tooLongTitleHits.push({ id: rowid, name });
  };

  const scanCell = (page, cell) => {
    if (!parseCellRecord(page, cell, cellRecord)) {
      counts.malformed_records += 1;
    } else if (fitsTracksTable(cellRecord)) {
      counts.tracks_rows_seen += 1;
      if (!hasMatchableFields(cellRecord)) return;
      if (isFieldLocal(cellRecord, TRACK_FIELDS.lastLyricsId)) keepIfCandidate(cellRecord, cell.rowid);
      else noteTooLong(cellRecord, cell.rowid);
    } else if (fitsLyricsTable(cellRecord)) {
      counts.lyrics_rows_seen += 1;
    } else if (fitsSequenceTable(cellRecord) && isFieldLocal(cellRecord, 1)) {
      sqliteSequence[readField(cellRecord, 0)] = Number(readField(cellRecord, 1));
    } else if (fitsStat1Table(cellRecord) && isFieldLocal(cellRecord, STAT1_FIELDS.stat)) {
      // A partial index counts only its own rows, so a table's row count is the largest it's given.
      const table = readField(cellRecord, STAT1_FIELDS.table);
      const rows = Number.parseInt(readField(cellRecord, STAT1_FIELDS.stat), 10);
      rowsAtLastAnalyze[table] = Math.max(rowsAtLastAnalyze[table] ?? 0, rows);
    }
  };

  const passes = [];
  await runPass(
    passes,
    () => `${counts.tracks_rows_seen} tracks and ${counts.lyrics_rows_seen} lyrics rows seen, ${rowsKept} rows kept`,
    (page, pageNumber) => {
      firstByteCounts[page[0]] += 1;
      if (isTableLeafPage(page, pageNumber, header)) {
        counts.unreadable_cells += forEachTableCell(page, pageNumber, header, scanCell);
      }
    },
  );

  writeMeta({
    ...counts,
    inputs,
    passes,
    rows_kept: rowsKept,
    too_long_title_hits: tooLongTitleHits,
    sqlite_sequence: sqliteSequence,
    rows_at_last_analyze: rowsAtLastAnalyze,
    first_byte_counts: Object.fromEntries(
      firstByteCounts.flatMap((pages, byte) =>
        pages === 0 ? [] : [[`0x${byte.toString(16).padStart(2, '0')}`, pages]],
      ),
    ),
    tracks_scan_finished_at: new Date().toISOString(),
  });
  batches.finish();
  printCompletenessCheck(readMeta());
}

// credit_matched answers for the rules at the time of the scan, and they can have changed since.
function refreshCreditMatches() {
  out.function('credit_matches', (name, artist, album, duration) => {
    const tracks = tracksToCheck(index, { trackName: name, artistName: artist, duration });
    return someTrackMayUse(tracks, name, artist, album, duration) ? 1 : 0;
  });
  const { changes } = out
    .prepare(
      `UPDATE dump_tracks SET credit_matched = credit_matches(name, artist_name, album_name, duration)
       WHERE credit_matched <> credit_matches(name, artist_name, album_name, duration)`,
    )
    .run();
  if (changes > 0) console.log(`Rows whose credit match changed since the last run: ${changes}`);
}

async function collectLyrics(meta) {
  const { passes, unreadable_ids: unreadableBefore = [], not_found_ids: notFoundBefore = [] } = meta;
  const alreadyAnswered = new Set([...unreadableBefore, ...notFoundBefore]);
  const wanted = new Set(
    out
      .prepare(
        `SELECT DISTINCT t.last_lyrics_id
         FROM dump_tracks t
         LEFT JOIN dump_lyrics l ON l.id = t.last_lyrics_id
         WHERE t.credit_matched = 1 AND l.id IS NULL`,
      )
      .pluck()
      .all()
      .filter((id) => !alreadyAnswered.has(id)),
  );
  if (wanted.size === 0 && meta.lyrics_scan_finished_at !== undefined) return;

  const isLastLyricsOf = out.prepare('SELECT 1 FROM dump_tracks WHERE id = ? AND last_lyrics_id = ?').pluck();
  const insert = out.prepare(
    `INSERT INTO dump_lyrics (id, track_id, plain_lyrics, synced_lyrics, has_plain_lyrics, has_synced_lyrics,
       instrumental, source, created_at, updated_at, lyricsfile, has_lyricsfile, has_word_sync)
     VALUES (@id, @track_id, @plain_lyrics, @synced_lyrics, @has_plain_lyrics, @has_synced_lyrics,
       @instrumental, @source, @created_at, @updated_at, @lyricsfile, @has_lyricsfile, @has_word_sync)
     ON CONFLICT (id) DO NOTHING`,
  );
  const remove = out.prepare('DELETE FROM dump_lyrics WHERE id = ?');

  const cellRecord = createRecord();
  const unreadable = new Set();
  let lookAlikes = 0;
  let rowsKept = 0;
  const batches = startBatches();

  const keepIfGenuine = (record, rowid) => {
    const row = readLyricsRow(record);
    if (isLastLyricsOf.get(row.track_id, rowid) === undefined) {
      lookAlikes += 1;
      return;
    }
    insert.run({ id: rowid, ...row });
    wanted.delete(rowid);
    rowsKept += 1;
    batches.rowWritten();
  };

  const readWantedRows = async () => {
    const chains = createOverflowChains(header, {
      onRowWhole(rowid, payload) {
        // Can't fail: the same header bytes passed when the row was first seen.
        parseWholeRecord(payload, cellRecord);
        keepIfGenuine(cellRecord, rowid);
      },
      onRowBroken(rowid) {
        unreadable.add(rowid);
        rowsKept -= remove.run(rowid).changes;
      },
    });

    const scanCell = (page, cell) => {
      if (!wanted.has(cell.rowid)) return;
      if (!parseCellRecord(page, cell, cellRecord) || !fitsLyricsTable(cellRecord)) return;
      if (cell.overflowPage === 0) keepIfGenuine(cellRecord, cell.rowid);
      else chains.start(cell.rowid, page, cell);
    };

    const read = async (onPage) => {
      await runPass(passes, () => `${rowsKept} rows kept, ${chains.rowsOwed()} rows owed`, onPage);
      writeMeta({ passes });
      batches.commit();
    };

    await read((page, pageNumber) => {
      chains.offerPage(page, pageNumber);
      if (isTableLeafPage(page, pageNumber, header)) forEachTableCell(page, pageNumber, header, scanCell);
      return wanted.size === 0 && chains.rowsOwed() === 0 ? STOP : undefined;
    });
    chains.layOutRemainingPages();
    if (chains.rowsOwed() > 0) {
      await read((page, pageNumber) => {
        chains.offerPage(page, pageNumber);
        return chains.rowsOwed() === 0 ? STOP : undefined;
      });
    }
  };

  if (wanted.size > 0) await readWantedRows();

  const wantedInAll = out
    .prepare('SELECT COUNT(DISTINCT last_lyrics_id) FROM dump_tracks WHERE credit_matched = 1')
    .pluck()
    .get();
  const count = (where) => out.prepare(`SELECT COUNT(*) FROM dump_lyrics ${where}`).pluck().get();
  writeMeta({
    wanted: wantedInAll,
    found: count(''),
    unreadable_ids: [...unreadableBefore, ...unreadable],
    not_found_ids: [...notFoundBefore, ...[...wanted].filter((id) => !unreadable.has(id))],
    look_alikes: (meta.look_alikes ?? 0) + lookAlikes,
    lyricsfile_without_synced: count('WHERE has_lyricsfile AND synced_lyrics IS NULL'),
    lyrics_scan_finished_at: new Date().toISOString(),
  });
  batches.finish();
}

function printSummary(meta) {
  const tooLongTitleHits = meta.too_long_title_hits;
  console.log('Passes:');
  console.table(meta.passes);
  console.log('Pages by first byte:');
  console.table(meta.first_byte_counts);
  printCompletenessCheck(meta);
  console.table({
    'library tracks': libraryTracks.length,
    'tracks rows too long to read': meta.tracks_rows_too_long,
    'of those, with a title in the library': tooLongTitleHits?.length ?? 'not checked',
    'unreadable cells': meta.unreadable_cells,
    'malformed records': meta.malformed_records,
    'duplicate track rowids': meta.duplicate_track_rowids,
    'rows kept': meta.rows_kept,
    wanted: meta.wanted,
    found: meta.found,
    unreadable: meta.unreadable_ids.length,
    'not found': meta.not_found_ids.length,
    'look-alikes': meta.look_alikes,
    'has_lyricsfile with no synced_lyrics': meta.lyricsfile_without_synced,
  });
  if (tooLongTitleHits?.length > 0) {
    console.log('Rows too long to read, with a title in the library:');
    console.table(tooLongTitleHits);
  }
}

const inputs = inputsOf();
const earlier = readMeta();
if (earlier.tracks_scan_finished_at === undefined) {
  await scanTracks(inputs);
} else if (JSON.stringify(earlier.inputs) !== JSON.stringify(inputs)) {
  throw new Error(`${args.out} was scanned from a different dump or library. Delete it to scan again.`);
} else {
  console.log(`The tracks scan in ${args.out} is finished, so it's skipped`);
  refreshCreditMatches();
}

await collectLyrics(readMeta());
printSummary(readMeta());
out.close();
console.log(`Extract: ${args.out}`);
