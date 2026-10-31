/*
 * Fills lyrics-library/lyrics.db from what extract.mjs pulled out of LRCLIB's dump, for the tracks in a library.db. It
 * only ever reads those two, it starts over on every run, and a run takes a couple of minutes. extract.mjs says which rule
 * changes this can take on its own.
 *
 * Lyrics are copyrighted, so the folder stays out of git. Phase 6 imports it into library.db.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import Database from 'better-sqlite3';
import { hashOfLibrary, indexLibrary, lrclib, readLibraryTracks, tracksToCheck } from './libraryTracks.mjs';

const DEFAULT_OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../lyrics-library/lyrics.db');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS lyrics (
    rel_path TEXT PRIMARY KEY,
    audio_hash TEXT NOT NULL,
    artist TEXT NOT NULL,
    album TEXT,
    title TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('found', 'not_found', 'instrumental')),
    synced_lrc TEXT,
    plain_text TEXT,
    matched_via TEXT,
    lrclib_id INTEGER,
    lrclib_artist TEXT,
    lrclib_album TEXT,
    lrclib_title TEXT,
    lrclib_duration REAL,
    fetched_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS lyrics_audio_hash ON lyrics (audio_hash);
`;

const { values: args } = parseArgs({
  options: {
    library: { type: 'string' },
    extract: { type: 'string' },
    out: { type: 'string', default: DEFAULT_OUT },
  },
});

if (args.library === undefined || args.extract === undefined) {
  console.error(
    'Usage: node scripts/lyrics-dump/match.mjs --library <library.db> --extract <extract.db> [--out <lyrics.db>]',
  );
  process.exit(1);
}

function openExtract(path, tracks) {
  const extract = new Database(path, { readonly: true, fileMustExist: true });
  const rows = extract.prepare('SELECT key, value FROM meta').all();
  const meta = Object.fromEntries(rows.map(({ key, value }) => [key, JSON.parse(value)]));
  if (meta.lyrics_scan_finished_at === undefined) {
    throw new Error(`${path} isn't finished: run extract.mjs on it again`);
  }
  // A track added since the scan would come out not_found, as if LRCLIB had nothing for it.
  if (meta.inputs.library !== hashOfLibrary(tracks)) {
    throw new Error(
      `${path} was scanned from a different library. Pass that one, or delete the extract to scan again.`,
    );
  }
  return { extract, meta };
}

function findCandidates(extract, tracks) {
  const index = indexLibrary(tracks);
  const candidates = new Map();
  const rows = extract
    .prepare('SELECT id, name, artist_name, album_name, duration, last_lyrics_id FROM dump_tracks ORDER BY id')
    .iterate();
  for (const row of rows) {
    const record = {
      id: row.id,
      trackName: row.name,
      artistName: row.artist_name,
      albumName: row.album_name ?? '',
      duration: row.duration,
      lyricsId: row.last_lyrics_id,
    };
    for (const track of tracksToCheck(index, record)) {
      if (!lrclib.mayAnswer(track, record)) continue;
      if (!candidates.has(track.relPath)) candidates.set(track.relPath, new Map());
      candidates.get(track.relPath).set(row.id, record);
    }
  }
  return candidates;
}

function viaOf(track, record) {
  if (!lrclib.artistsMatch(track.artist, record.artistName)) return 'same_album';
  const sameName =
    lrclib.normalizeName(track.title) === lrclib.normalizeName(record.trackName) &&
    lrclib.normalizeName(track.artist) === lrclib.normalizeName(record.artistName);
  if (!sameName) return 'search';
  const sameAlbum =
    track.album !== null && lrclib.normalizeName(track.album) === lrclib.normalizeName(record.albumName);
  return sameAlbum ? 'exact' : 'any_album';
}

function rowOf(track, lyrics) {
  const match = lyrics.status === 'not_found' ? null : lyrics.match;
  return {
    ...track,
    status: lyrics.status,
    syncedLrc: lyrics.status === 'found' ? lyrics.syncedLrc : null,
    plainText: lyrics.status === 'found' ? lyrics.plainText : null,
    matchedVia: match?.via ?? null,
    lrclibId: match?.id ?? null,
    lrclibArtist: match?.artist ?? null,
    lrclibAlbum: match?.album ?? null,
    lrclibTitle: match?.title ?? null,
    lrclibDuration: match?.durationSeconds ?? null,
    fetchedAt: Date.now(),
  };
}

const tracks = readLibraryTracks(args.library);
console.log(`${tracks.length} tracks in the library`);

const { extract, meta } = openExtract(args.extract, tracks);
const candidates = findCandidates(extract, tracks);

const unreadableIds = new Set(meta.unreadable_ids);
const notFoundIds = new Set(meta.not_found_ids);
const noLyrics = { unreadable: new Set(), notFound: new Set(), notRead: new Set() };

const noteNoLyrics = ({ id, lyricsId }) => {
  if (unreadableIds.has(lyricsId)) noLyrics.unreadable.add(id);
  else if (notFoundIds.has(lyricsId)) noLyrics.notFound.add(id);
  else noLyrics.notRead.add(id);
};

const lyricsOf = extract.prepare('SELECT plain_lyrics, synced_lyrics, instrumental FROM dump_lyrics WHERE id = ?');
const withLyrics = (record) => {
  const row = lyricsOf.get(record.lyricsId);
  if (row === undefined) noteNoLyrics(record);
  return {
    ...record,
    instrumental: Boolean(row?.instrumental),
    plainLyrics: row?.plain_lyrics ?? null,
    syncedLyrics: row?.synced_lyrics ?? null,
  };
};

const answer = (track) => {
  const records = [...(candidates.get(track.relPath)?.values() ?? [])].map(withLyrics);
  const best = lrclib.pickBestRecord(track, records);
  if (best !== null) return lrclib.lyricsFrom(best, track, viaOf(track, best));
  const loose = lrclib.pickLooseRecord(track, records);
  return loose === null ? { status: 'not_found' } : lrclib.lyricsFrom(loose, track, 'loose');
};

mkdirSync(dirname(args.out), { recursive: true });
const out = new Database(args.out);
out.exec(SCHEMA);
const save = out.prepare(
  `INSERT INTO lyrics (rel_path, audio_hash, artist, album, title, duration_ms, status, synced_lrc,
     plain_text, matched_via, lrclib_id, lrclib_artist, lrclib_album, lrclib_title, lrclib_duration, fetched_at)
   VALUES (@relPath, @audioHash, @artist, @album, @title, @durationMs, @status, @syncedLrc,
     @plainText, @matchedVia, @lrclibId, @lrclibArtist, @lrclibAlbum, @lrclibTitle, @lrclibDuration, @fetchedAt)`,
);
out.transaction(() => {
  out.exec('DELETE FROM lyrics');
  for (const track of tracks) save.run(rowOf(track, answer(track)));
})();
extract.close();

console.table(
  out
    .prepare(
      `SELECT status, matched_via AS via, synced_lrc IS NOT NULL AS synced, COUNT(*) AS tracks
       FROM lyrics GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
    )
    .all(),
);
out.close();

console.log(
  `Records that match a track but have no lyrics in the extract: ${noLyrics.unreadable.size} unreadable, ` +
    `${noLyrics.notFound.size} not found in the dump, ${noLyrics.notRead.size} not read yet`,
);
if (noLyrics.notRead.size > 0) {
  console.log("Records match that the last extract didn't read: run extract.mjs again");
}
console.log(`Library: ${args.out}`);
