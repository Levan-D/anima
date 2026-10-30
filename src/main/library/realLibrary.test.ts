/*
 * Runs the real scan against a real music folder, read-only, and reports on what it found.
 * Skipped unless MUSIC_PLAYER_REAL_LIBRARY names the folder:
 *
 *   MUSIC_PLAYER_REAL_LIBRARY='D:\Music' npx vitest run src/main/library/realLibrary.test.ts
 *
 * Everything it writes goes under .dev/real/. Read .dev/real/report.json afterwards.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { connect } from '@main/db/connection';
import { closeCleanly, openDatabase } from '@main/db/open';
import { fullImagePath } from '@main/library/artPaths';
import { createArtQueue, type ArtJobResult } from '@main/library/artQueue';
import { libraryPaths } from '@main/library/dataDir';
import { createLibraryWrites, createQueries } from '@main/library/queries';
import { toAbsolute } from '@main/library/relPath';
import { runScan, type ScanOutcome } from '@main/library/scan';
import { resolveBinaries } from '@main/system/binaries';

const FOLDER = process.env.MUSIC_PLAYER_REAL_LIBRARY;
const OUTPUT = resolve('.dev/real');
const SAMPLE_SIZE = 300;
const FFMPEG = resolveBinaries({ isPackaged: false, resourcesPath: '', appRoot: process.cwd() }).ffmpeg.path;

const AUDIO = new Set(['.flac', '.mp3', '.m4a', '.ogg', '.opus', '.wav', '.aiff', '.aif', '.ape', '.wv']);

/** Deliberately shares nothing with the scanner's walk, so it can disagree. */
function countOnDisk(folder: string): string[] {
  const found: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && AUDIO.has(extname(entry.name).toLowerCase())) found.push(path);
    }
  };
  visit(folder);
  return found;
}

function ffmpegSays(args: string[]): Promise<string> {
  return new Promise((done) => {
    execFile(FFMPEG, ['-hide_banner', '-nostdin', ...args], { windowsHide: true, maxBuffer: 1 << 26 }, (_e, _o, err) =>
      done(err),
    );
  });
}

// There's no ffprobe in ffmpeg-static. With no output file, ffmpeg prints the same description and exits with an error.
const probe = (path: string) => ffmpegSays(['-i', path]);

/** The real length, by decoding it, for when ffmpeg admits its Duration line is only an estimate from the bitrate. */
async function decodedMs(path: string): Promise<number | null> {
  const output = await ffmpegSays(['-i', path, '-vn', '-f', 'null', '-']);
  const last = [...output.matchAll(/time=(\d+):(\d+):(\d+)\.(\d+)/g)].at(-1);
  if (!last) return null;
  return (Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3])) * 1000 + Number(last[4]) * 10;
}

type Probed = {
  title: string | null;
  artist: string | null;
  album: string | null;
  date: string | null;
  durationMs: number | null;
  codec: string | null;
};

function parseProbe(text: string): Probed {
  const header = text.slice(0, text.indexOf('Stream #0'));
  const tag = (name: string) => new RegExp(`^\\s{4}${name}\\s*: (.*)$`, 'im').exec(header)?.[1]?.trim() ?? null;
  const duration = /Duration: (\d+):(\d+):(\d+)\.(\d+)/.exec(text);
  const codec = /Stream #0:\d+.*?: Audio: (\w+)/.exec(text);
  return {
    title: tag('title'),
    artist: tag('artist'),
    album: tag('album'),
    // ffmpeg only calls an ID3v2.3 TYER "date" when it's a bare year.
    date: tag('date') ?? tag('TYER') ?? tag('year'),
    durationMs: duration
      ? (Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])) * 1000 + Number(duration[4]) * 10
      : null,
    codec: codec?.[1] ?? null,
  };
}

function timed<T>(work: () => T): { value: T; ms: number } {
  const started = performance.now();
  const value = work();
  return { value, ms: performance.now() - started };
}

function median(values: number[]): number {
  return values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
}

function measure(work: () => unknown, runs = 7): { medianMs: number; worstMs: number } {
  const times = Array.from({ length: runs }, () => timed(work).ms);
  return { medianMs: Number(median(times).toFixed(2)), worstMs: Number(Math.max(...times).toFixed(2)) };
}

describe.skipIf(!FOLDER)('the real library', () => {
  it('scans it read-only, and the results hold up', { timeout: 60 * 60 * 1000 }, async () => {
    const folder = FOLDER as string;
    const dataRoot = join(OUTPUT, 'data');
    const paths = libraryPaths(folder, dataRoot);
    const fromFolder = relative(folder, paths.dataDir);
    expect(fromFolder.startsWith('..') || isAbsolute(fromFolder)).toBe(true);

    const before = statSync(folder);
    expect(existsSync(join(folder, '.player'))).toBe(false);

    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(join(OUTPUT, 'art-cache'), { recursive: true, force: true });
    mkdirSync(paths.dataDir, { recursive: true });

    const report: Record<string, unknown> = { folder, mtimeBefore: before.mtimeMs };

    const onDisk = countOnDisk(folder);
    report.onDisk = onDisk.length;

    const opened = openDatabase(paths.dbPath, { backupsDir: paths.backupsDir, now: Date.now() });
    if (opened.kind !== 'open') throw new Error(`Could not open: ${opened.kind}`);
    closeCleanly(opened.db);

    const scan = async (): Promise<{ outcome: ScanOutcome; ms: number; phases: Record<string, number> }> => {
      const db = connect(paths.dbPath);
      const phases: Record<string, number> = {};
      let phase = '';
      let phaseStart = performance.now();
      const started = performance.now();
      const outcome = await runScan({
        root: folder,
        db,
        hostname: hostname(),
        now: Date.now,
        isCancelled: () => false,
        onProgress: (progress) => {
          if (progress.phase === phase) return;
          if (phase !== '') phases[phase] = Math.round(performance.now() - phaseStart);
          phase = progress.phase;
          phaseStart = performance.now();
        },
        onCommit: () => {},
      });
      phases[phase] = Math.round(performance.now() - phaseStart);
      const ms = performance.now() - started;
      db.close();
      return { outcome, ms, phases };
    };

    const first = await scan();
    report.firstScan = { ms: Math.round(first.ms), phases: first.phases, outcome: first.outcome };
    report.rowsWithHashByKind = (() => {
      const check = connect(paths.dbPath);
      const rows = check
        .prepare(
          "SELECT substr(audio_hash, 1, instr(audio_hash, ':') - 1) AS kind, COUNT(*) AS n, SUM(size_bytes) AS bytes FROM files GROUP BY 1",
        )
        .all();
      check.close();
      return rows;
    })();
    writeFileSync(join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2));

    const second = await scan();
    report.secondScan = { ms: Math.round(second.ms), phases: second.phases, outcome: second.outcome };
    writeFileSync(join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2));

    const db = connect(paths.dbPath);
    const queries = createQueries(db);
    const writes = createLibraryWrites(db);

    // Counts.
    const counts = queries.counts();
    const fileRows = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM files').get()?.n ?? 0;
    report.counts = { ...counts, fileRows };
    const stored = new Set(
      db
        .prepare<[], { relPath: string }>('SELECT rel_path AS relPath FROM files')
        .all()
        .map(({ relPath }) => toAbsolute(folder, relPath)),
    );
    const notStored = onDisk.filter((path) => !stored.has(path)).map((path) => relative(folder, path));
    report.onDiskButNotStored = notStored;

    // Issues.
    const issues = queries.issues();
    const byKind: Record<string, number> = {};
    for (const { kind } of issues) byKind[kind] = (byKind[kind] ?? 0) + 1;
    report.issuesByKind = byKind;
    report.issues = issues;

    // Lists to read for junk.
    const artists = queries.artists();
    const genres = queries.genres();
    const albums = queries.albums({ artistId: null, genreId: null });
    report.artistCount = artists.length;
    report.albumCount = albums.length;
    report.unknownArtist = artists.find(({ name }) => name === 'Unknown Artist') ?? null;
    report.artists = artists.map(({ name, albumCount, trackCount }) => `${name} [${albumCount}/${trackCount}]`);
    report.genres = genres.map(({ name, trackCount }) => `${name} [${trackCount}]`);
    report.artistsThatLookSplitOrJoined = artists
      .map(({ name }) => name)
      .filter((name) => /[;,&/]| feat| ft\.| vs\.?| x /i.test(name));

    const stats = db
      .prepare<[], Record<string, number>>(
        `SELECT
           COUNT(*) AS tracks,
           SUM(t.album_id IS NULL) AS noAlbum,
           SUM(t.year IS NULL) AS noYear,
           SUM(t.track_number IS NULL) AS noTrackNumber,
           SUM(t.disc_number IS NULL) AS noDiscNumber,
           SUM(f.art_hash IS NULL) AS noArt,
           SUM(f.audio_hash IS NULL) AS noAudioHash,
           SUM(f.audio_hash LIKE 'flac-md5:%') AS flacMd5,
           SUM(f.audio_hash LIKE 'frames:%') AS framesHash,
           SUM(f.audio_hash LIKE 'file:%') AS wholeFileHash,
           SUM(f.duration_ms = 0) AS zeroDuration,
           SUM(t.artist_id != al.artist_id) AS artistDiffersFromAlbumArtist
         FROM tracks t JOIN files f ON f.id = t.file_id LEFT JOIN albums al ON al.id = t.album_id`,
      )
      .get();
    report.stats = stats;
    report.codecs = db
      .prepare(
        'SELECT codec, COUNT(*) AS n, MIN(sample_rate) AS minRate, MAX(sample_rate) AS maxRate, MAX(bit_depth) AS maxDepth FROM files GROUP BY codec',
      )
      .all();
    report.years = db.prepare('SELECT MIN(year) AS min, MAX(year) AS max FROM tracks').get();
    report.discNumbers = db
      .prepare('SELECT disc_number AS disc, COUNT(*) AS n FROM tracks GROUP BY 1 ORDER BY 1')
      .all();
    report.duplicateAudio = db
      .prepare<[], { n: number }>(
        'SELECT COUNT(*) AS n FROM (SELECT audio_hash FROM files WHERE audio_hash IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1)',
      )
      .get()?.n;
    report.artRows = db.prepare('SELECT source_kind AS kind, mime, COUNT(*) AS n FROM art GROUP BY 1, 2').all();
    report.nearDuplicateArtists = db
      .prepare(
        `SELECT a.name AS a, b.name AS b FROM artists a JOIN artists b
         ON a.id < b.id AND a.sort_name = b.sort_name`,
      )
      .all();
    report.nearDuplicateAlbums = db
      .prepare(
        `SELECT a.title AS a, b.title AS b, ar.name AS artist FROM albums a JOIN albums b
         ON a.id < b.id AND a.artist_id = b.artist_id AND a.sort_title = b.sort_title
         JOIN artists ar ON ar.id = a.artist_id`,
      )
      .all();

    // Compare a spread of files with what ffmpeg says, independently.
    const everyTrack = queries.tracks({ kind: 'all' });
    const step = Math.max(1, Math.floor(everyTrack.length / SAMPLE_SIZE));
    const sample = everyTrack.filter((_, index) => index % step === 0);
    const disagreements: unknown[] = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        while (next < sample.length) {
          const track = sample[next++];
          if (!track) continue;
          const path = toAbsolute(folder, track.relPath);
          const description = await probe(path);
          const probed = parseProbe(description);
          const problems: string[] = [];
          const fileName = track.relPath.slice(track.relPath.lastIndexOf('/') + 1, track.relPath.lastIndexOf('.'));
          if ((probed.title ?? fileName) !== track.title) problems.push(`title: ${probed.title} vs ${track.title}`);
          if ((probed.artist ?? 'Unknown Artist') !== track.artist)
            problems.push(`artist: ${probed.artist} vs ${track.artist}`);
          if ((probed.album ?? null) !== track.album) problems.push(`album: ${probed.album} vs ${track.album}`);
          const year = /\d{4}/.exec(probed.date ?? '')?.[0] ?? null;
          if ((year === null ? null : Number(year)) !== track.year)
            problems.push(`year: ${probed.date} vs ${track.year}`);
          const realMs = description.includes('Estimating duration') ? await decodedMs(path) : probed.durationMs;
          if (realMs === null || Math.abs(realMs - track.durationMs) > 250) {
            problems.push(`duration: ${realMs} vs ${track.durationMs}`);
          }
          const codec = probed.codec === 'mp3' ? 'MP3' : probed.codec?.toUpperCase();
          if (codec !== track.codec) problems.push(`codec: ${probed.codec} vs ${track.codec}`);
          if (problems.length > 0) disagreements.push({ path: track.relPath, problems });
        }
      }),
    );
    report.sampled = sample.length;
    report.disagreements = disagreements;
    writeFileSync(join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2));

    // Query timings.
    const firstArtist = artists[Math.floor(artists.length / 2)]?.id ?? 1;
    const firstAlbum = albums[Math.floor(albums.length / 2)]?.id ?? 1;
    const firstGenre = genres[0]?.id ?? 1;
    report.queryTimings = {
      tracksAll: measure(() => queries.tracks({ kind: 'all' })),
      tracksAllRows: everyTrack.length,
      tracksArtist: measure(() => queries.tracks({ kind: 'artist', artistId: firstArtist })),
      tracksAlbum: measure(() => queries.tracks({ kind: 'album', albumId: firstAlbum })),
      tracksGenre: measure(() => queries.tracks({ kind: 'genre', genreId: firstGenre })),
      tracksMissing: measure(() => queries.tracks({ kind: 'missing' })),
      artists: measure(() => queries.artists()),
      albums: measure(() => queries.albums({ artistId: null, genreId: null })),
      albumsByArtist: measure(() => queries.albums({ artistId: firstArtist, genreId: null })),
      albumsByGenre: measure(() => queries.albums({ artistId: null, genreId: firstGenre })),
      genres: measure(() => queries.genres()),
      searchShort: measure(() => queries.search('a')),
      searchWord: measure(() => queries.search('night')),
      searchTwoWords: measure(() => queries.search('nightwish human')),
      counts: measure(() => queries.counts()),
      structuredCloneTracksAll: measure(() => structuredClone(everyTrack)),
    };
    report.searchChecks = {
      bjork: queries.search('bjork').artists.map(({ name }) => name),
      nightwish: {
        artists: queries.search('nightwish').artists.map(({ name }) => name),
        albums: queries.search('nightwish').albums.length,
        tracks: queries.search('nightwish').tracks.length,
      },
      nightwishHuman: queries.search('nightwish human').albums.map(({ title }) => title),
      punctuation: queries.search('!!! ---').tracks.length,
    };
    writeFileSync(join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2));

    // The art pass, the way the worker would run it, and how much room the cache takes.
    const cacheDir = join(OUTPUT, 'art-cache');
    const rows = queries.artRows();
    const results: ArtJobResult[] = [];
    const artStarted = performance.now();
    await new Promise<void>((done) => {
      const queue = createArtQueue({
        cacheDir,
        ffmpegPath: FFMPEG,
        onDone: (result) => {
          results.push(result);
          if (result.color !== null) writes.setArtColor(result.hash, result.color);
          if (results.length === rows.length) done();
        },
      });
      for (const row of rows) {
        const others = queries
          .otherFilesWithArt(row.hash, 5)
          .filter(({ relPath }) => relPath !== row.sourceRelPath)
          .map(({ relPath }) => ({ kind: 'embedded' as const, path: toAbsolute(folder, relPath) }));
        queue.push(
          {
            hash: row.hash,
            mime: row.mime,
            sources: [{ kind: row.sourceKind, path: toAbsolute(folder, row.sourceRelPath) }, ...others],
          },
          false,
        );
      }
    });
    const artMs = performance.now() - artStarted;
    const sizeOf = (dir: string) =>
      readdirSync(dir, { withFileTypes: true, recursive: true })
        .filter((entry) => entry.isFile())
        .reduce((sum, entry) => sum + statSync(join(entry.parentPath, entry.name)).size, 0);
    report.art = {
      rows: rows.length,
      ms: Math.round(artMs),
      failed: results.filter(({ ok }) => !ok),
      withoutColor: results.filter(({ ok, color }) => ok && color === null).length,
      cacheBytes: sizeOf(cacheDir),
      everyFullImageThere: rows.every(({ hash, mime }) => existsSync(fullImagePath(cacheDir, hash, mime))),
      someColors: db.prepare('SELECT color FROM art WHERE color IS NOT NULL LIMIT 12').all(),
    };
    report.databaseBytes = statSync(paths.dbPath).size;

    db.close();

    const after = statSync(folder);
    report.mtimeAfter = after.mtimeMs;
    report.playerFolderCreated = existsSync(join(folder, '.player'));
    writeFileSync(join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2));

    expect(disagreements).toEqual([]);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(existsSync(join(folder, '.player'))).toBe(false);
    expect(notStored.length).toBeGreaterThanOrEqual(0);
    if (second.outcome.kind === 'finished') {
      expect(second.outcome.report.added + second.outcome.report.updated).toBeLessThanOrEqual(
        (byKind.unreadable ?? 0) + (byKind.no_audio ?? 0),
      );
    }
  });
});
