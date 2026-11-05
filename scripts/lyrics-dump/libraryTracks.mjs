/* The library's side of matching: its tracks, lrclib.ts's rules, and the keys that connect the two to a dump. */
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { runnerImport } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const { module: lrclib } = await runnerImport(join(root, 'src/main/lyrics/lrclib.ts'), {
  configFile: false,
  logLevel: 'error',
  resolve: { alias: { '@shared': join(root, 'src/shared'), '@main': join(root, 'src/main') } },
});

export { lrclib };

export function readLibraryTracks(path) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  const tracks = db
    .prepare(
      `SELECT f.rel_path AS relPath, f.audio_hash AS audioHash, t.title, a.name AS artist,
              al.title AS album, f.duration_ms AS durationMs
       FROM tracks t
       JOIN files f ON f.id = t.file_id
       JOIN artists a ON a.id = t.artist_id
       LEFT JOIN albums al ON al.id = t.album_id
       WHERE f.missing_since IS NULL AND a.name <> 'Unknown Artist'
       ORDER BY f.rel_path`,
    )
    .all();
  db.close();
  return tracks;
}

/**
 * What a tracks scan depends on, so an extract can say which library it answers for. The album isn't in it: the scan keeps
 * rows whatever their album, so a retagged album only takes extract.mjs reading the lyrics of the rows it now credits.
 */
export function hashOfLibrary(tracks) {
  const scanned = tracks.map(({ title, artist, durationMs }) => [title, artist, durationMs]);
  return createHash('sha256').update(JSON.stringify(scanned)).digest('hex');
}

export function titleKeys(title) {
  const base = lrclib.baseTitle(title);
  return base === title ? [lrclib.normalizeName(title)] : [lrclib.normalizeName(title), lrclib.normalizeName(base)];
}

function addTo(map, key, track) {
  const tracks = map.get(key);
  if (tracks === undefined) map.set(key, [track]);
  else tracks.push(track);
}

export function indexByTitle(tracks) {
  const byTitle = new Map();
  for (const track of tracks) {
    const named = lrclib.trackNamedInTitle(track);
    const keys = titleKeys(track.title).concat(named === null ? [] : titleKeys(named.title));
    for (const key of keys) addTo(byTitle, key, track);
  }
  return byTitle;
}

/** The library tracks a dump title could be. A track sharing both of a title's keys comes back twice. */
export function tracksWithTitle(byTitle, title) {
  return titleKeys(title).flatMap((key) => byTitle.get(key) ?? []);
}

function wordRuns(name, longest = Infinity) {
  const words = name.split(' ');
  return words.flatMap((_, start) =>
    words.slice(start, start + longest).map((__, end) => words.slice(start, start + end + 1).join(' ')),
  );
}

export function indexLibrary(tracks) {
  const byArtist = new Map();
  const byPartOfArtist = new Map();
  let longestArtist = 0;
  for (const track of tracks) {
    const artist = lrclib.normalizeName(track.artist);
    longestArtist = Math.max(longestArtist, artist.split(' ').length);
    addTo(byArtist, artist, track);
    for (const run of wordRuns(artist)) addTo(byPartOfArtist, run, track);
  }
  return { byTitle: indexByTitle(tracks), byArtist, byPartOfArtist, longestArtist };
}

/** The tracks by an artist lrclib.ts would take this one for, without comparing it to every artist in the library. */
function tracksByArtist({ byArtist, byPartOfArtist, longestArtist }, artistName) {
  const artist = lrclib.normalizeName(artistName);
  const containedByRow = wordRuns(artist, longestArtist).flatMap((run) => byArtist.get(run) ?? []);
  return (byPartOfArtist.get(artist) ?? []).concat(containedByRow);
}

/**
 * The library tracks a dump row could answer for: any with its title, or by its artist at its length, where the title
 * can be a little off. lrclib.mayAnswer has the last word. A track can come back twice.
 */
export function tracksToCheck(index, { trackName, artistName, duration }) {
  const closeInLength = ({ durationMs }) => Math.abs(duration - durationMs / 1000) <= lrclib.DURATION_TOLERANCE_SECONDS;
  return tracksWithTitle(index.byTitle, trackName).concat(tracksByArtist(index, artistName).filter(closeInLength));
}
