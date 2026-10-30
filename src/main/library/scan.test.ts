import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from '@main/db/connection';
import { createLibraryMeta } from '@main/library/libraryMeta';
import { createQueries, type LibraryQueries } from '@main/library/queries';
import type { ScanProgress } from '@main/library/scan';
import {
  BASE_FILES_READABLE,
  closeTestDatabase,
  copyOfBaseLibrary,
  finishedScan,
  makeImage,
  makeTone,
  openTestDatabase,
  retag,
  scan,
  snapshot,
  tempDir,
} from '@main/library/testFixtures';

// Real files and real ffmpeg, on a machine shared with every other test file.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const FIRST = 'Artist One/Album A/01 First.flac';
const SECOND = 'Artist One/Album A/02 Second.flac';
const JOGA = 'Björk/Homogenic/Jóga.mp3';
const DISC_ONE = 'Artist One/Album B/CD1/01 Disc One.flac';

let root: string;
let data: string;
let dbPath: string;
let db: Connection;
let queries: LibraryQueries;

function at(relPath: string): string {
  return join(root, ...relPath.split('/'));
}

function trackAt(relPath: string) {
  return queries.tracks({ kind: 'all' }).find((track) => track.relPath === relPath);
}

function allTrackRows() {
  return db
    .prepare<[], { id: number; relPath: string; missingSince: number | null }>(
      `SELECT t.id, f.rel_path AS relPath, f.missing_since AS missingSince FROM tracks t JOIN files f ON f.id = t.file_id`,
    )
    .all();
}

function idOf(relPath: string): number {
  const row = allTrackRows().find((track) => track.relPath === relPath);
  if (!row) throw new Error(`No track at ${relPath}`);
  return row.id;
}

function addToPlaylist(trackId: number): number {
  const now = Date.now();
  const playlistId = Number(
    db.prepare('INSERT INTO playlists (name, created_at, updated_at) VALUES (?, ?, ?)').run('Keep', now, now)
      .lastInsertRowid,
  );
  db.prepare('INSERT INTO playlist_items (playlist_id, track_id, position) VALUES (?, ?, 0)').run(playlistId, trackId);
  return playlistId;
}

function playlistTrackIds(playlistId: number): number[] {
  return db
    .prepare<[number], { id: number }>('SELECT track_id AS id FROM playlist_items WHERE playlist_id = ?')
    .all(playlistId)
    .map(({ id }) => id);
}

beforeEach(() => {
  root = copyOfBaseLibrary('scan-lib');
  data = tempDir('scan-data');
  ({ dbPath, db } = openTestDatabase(data));
  queries = createQueries(db);
});

afterEach(() => {
  closeTestDatabase(db);
});

describe('a first scan', () => {
  it('finds every audio file and reports on it', async () => {
    const { report } = await finishedScan(root, dbPath);
    expect(report).toMatchObject({
      cancelled: false,
      looksEmpty: false,
      added: BASE_FILES_READABLE,
      updated: 0,
      moved: 0,
      nowMissing: 0,
      restored: 0,
      unchanged: 0,
      issues: 3,
    });
    expect(queries.tracks({ kind: 'all' })).toHaveLength(BASE_FILES_READABLE);
  });

  it('changes nothing in the music folder', async () => {
    const before = snapshot(root);
    await finishedScan(root, dbPath);
    expect(snapshot(root)).toEqual(before);
  });

  it('reads tags and format into tracks', async () => {
    await finishedScan(root, dbPath);
    expect(trackAt(FIRST)).toMatchObject({
      title: 'First',
      artist: 'Artist One',
      album: 'Album A',
      albumArtist: 'Artist One',
      year: 2001,
      trackNumber: 1,
      discNumber: null,
      genres: expect.arrayContaining(['Rock', 'Pop']) as string[],
      codec: 'FLAC',
      sampleRate: 44100,
      bitDepth: expect.any(Number) as number,
      isCueTrack: false,
      isMissing: false,
    });
    expect(trackAt(FIRST)?.durationMs).toBeGreaterThan(300);
    expect(trackAt(FIRST)?.durationMs).toBeLessThan(500);

    expect(trackAt(JOGA)).toMatchObject({
      title: 'Jóga',
      artist: 'Björk',
      album: 'Homogenic',
      year: 1997,
      codec: 'MP3',
    });
  });

  it('uses forward slashes in paths', async () => {
    await finishedScan(root, dbPath);
    for (const { relPath } of allTrackRows()) expect(relPath).not.toContain('\\');
  });

  it('gives a file with no tags its file name and Unknown Artist, and says so', async () => {
    await finishedScan(root, dbPath);
    expect(trackAt('No Tags/untagged.flac')).toMatchObject({
      title: 'untagged',
      artist: 'Unknown Artist',
      album: null,
      albumId: null,
    });
    expect(queries.issues()).toContainEqual(
      expect.objectContaining({ relPath: 'No Tags/untagged.flac', kind: 'bad_tags' }),
    );
  });

  it('leaves the album empty when there is no album tag', async () => {
    await finishedScan(root, dbPath);
    expect(trackAt('The Beatles/Single.mp3')).toMatchObject({ albumId: null, album: null, albumArtist: null });
  });

  it('skips what it should', async () => {
    await finishedScan(root, dbPath);
    const paths = allTrackRows().map(({ relPath }) => relPath);
    for (const path of paths) {
      expect(path).not.toMatch(/\.player|\$RECYCLE|System Volume|\._/);
    }
  });

  it('dedupes genres across files, keeping the first spelling', async () => {
    await finishedScan(root, dbPath);
    expect(queries.genres().map(({ name }) => name)).toEqual(['Jazz', 'Pop', 'Rock']);
    expect(queries.genres().find(({ name }) => name === 'Rock')?.trackCount).toBe(2);
  });

  it('keeps search in step with tracks, with rowid = track id', async () => {
    await finishedScan(root, dbPath);
    const rowids = db.prepare<[], { rowid: number }>('SELECT rowid FROM tracks_fts ORDER BY rowid').all();
    expect(rowids.map(({ rowid }) => rowid)).toEqual(
      allTrackRows()
        .map(({ id }) => id)
        .toSorted((a, b) => a - b),
    );
    expect(queries.search('bjork').artists.map(({ name }) => name)).toEqual(['Björk']);
    expect(queries.search('joga').tracks.map(({ title }) => title)).toEqual(['Jóga']);
  });

  it('reports phases in order, with relative paths', async () => {
    const seen: ScanProgress[] = [];
    await finishedScan(root, dbPath, { onProgress: (progress) => seen.push(progress) });
    const phases = seen.map(({ phase }) => phase).filter((phase, index, all) => phase !== all[index - 1]);
    expect(phases).toEqual(['walking', 'reading', 'hashing', 'writing']);
    for (const { currentPath } of seen) {
      expect(currentPath ?? '').not.toContain(root);
      expect(currentPath ?? '').not.toContain('\\');
    }
    expect(seen.find(({ phase }) => phase === 'writing')).toMatchObject({
      filesFound: BASE_FILES_READABLE,
      filesDone: BASE_FILES_READABLE,
    });
  });

  it('reads tags before it hashes anything, so the list fills first', async () => {
    const hashedAtEachCommit: number[] = [];
    await finishedScan(root, dbPath, {
      onCommit: () => {
        const { n } = db.prepare('SELECT COUNT(*) AS n FROM files WHERE audio_hash IS NOT NULL').get() as { n: number };
        hashedAtEachCommit.push(n);
      },
    });
    expect(hashedAtEachCommit).toEqual([0]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM files WHERE audio_hash IS NULL').get()).toEqual({ n: 0 });
  });

  it('commits in batches, so the list fills in live', async () => {
    const source = at(FIRST);
    for (let index = 0; index < 250; index++) copyFileSync(source, join(root, 'Artist One', `copy ${index}.flac`));
    let commits = 0;
    let rowsAtFirstCommit = 0;
    await finishedScan(root, dbPath, {
      onCommit: () => {
        if (commits++ === 0) rowsAtFirstCommit = allTrackRows().length;
      },
    });
    expect(commits).toBeGreaterThanOrEqual(3);
    expect(rowsAtFirstCommit).toBe(100);
  });

  it('records which machine changed the library', async () => {
    const meta = createLibraryMeta(db);
    expect(meta.lastChanged()).toBeNull();
    await finishedScan(root, dbPath, { hostname: 'the-main-pc', now: () => 1000 });
    expect(meta.lastChanged()).toEqual({ host: 'the-main-pc', at: 1000 });
    expect(meta.lastScanAt()).toBe(1000);
  });
});

describe('album rules', () => {
  const lib = (relPath: string) => join(root, 'New', relPath);

  beforeEach(() => {
    rmSync(join(root, 'Artist One'), { recursive: true });
  });

  it('groups by album artist and title, whoever plays the track', async () => {
    makeTone(lib('a.flac'), {
      frequency: 500,
      tags: { title: 'A', artist: 'Guest', album_artist: 'Host', album: 'Same' },
    });
    makeTone(lib('b.flac'), {
      frequency: 510,
      tags: { title: 'B', artist: 'Host', album_artist: 'Host', album: 'Same' },
    });
    await finishedScan(root, dbPath);
    const albums = queries.albums({ artistId: null, genreId: null }).filter(({ title }) => title === 'Same');
    expect(albums).toHaveLength(1);
    expect(albums[0]).toMatchObject({ artist: 'Host', trackCount: 2 });
    expect(trackAt('New/a.flac')).toMatchObject({ artist: 'Guest', albumArtist: 'Host' });
  });

  it('keeps albums of one name apart by album artist', async () => {
    makeTone(lib('a.flac'), { frequency: 500, tags: { title: 'A', artist: 'One', album: 'Greatest Hits' } });
    makeTone(lib('b.flac'), { frequency: 510, tags: { title: 'B', artist: 'Two', album: 'Greatest Hits' } });
    await finishedScan(root, dbPath);
    const albums = queries.albums({ artistId: null, genreId: null }).filter(({ title }) => title === 'Greatest Hits');
    expect(albums.map(({ artist }) => artist)).toEqual(['One', 'Two']);
  });

  it('dates an album by its lowest track year', async () => {
    makeTone(lib('a.flac'), { frequency: 500, tags: { title: 'A', artist: 'X', album: 'Mixed', date: '2005' } });
    makeTone(lib('b.flac'), { frequency: 510, tags: { title: 'B', artist: 'X', album: 'Mixed', date: '1998' } });
    makeTone(lib('c.flac'), { frequency: 520, tags: { title: 'C', artist: 'X', album: 'Mixed' } });
    await finishedScan(root, dbPath);
    expect(queries.albums({ artistId: null, genreId: null }).find(({ title }) => title === 'Mixed')?.year).toBe(1998);
  });

  it('takes album art from the lowest disc and track that has any', async () => {
    const red = join(data, 'red.png');
    const blue = join(data, 'blue.png');
    makeImage(red, 'red');
    makeImage(blue, 'blue');
    const tags = { artist: 'X', album: 'Art' };
    makeTone(lib('d2t1.flac'), { frequency: 500, picture: red, tags: { ...tags, title: 'A', disc: '2', track: '1' } });
    makeTone(lib('d1t3.flac'), { frequency: 510, picture: blue, tags: { ...tags, title: 'B', disc: '1', track: '3' } });
    makeTone(lib('d1t1.flac'), { frequency: 520, tags: { ...tags, title: 'C', disc: '1', track: '1' } });
    await finishedScan(root, dbPath);
    const album = queries.albums({ artistId: null, genreId: null }).find(({ title }) => title === 'Art');
    expect(album?.artHash).toBe(trackAt('New/d1t3.flac')?.artHash);
    expect(album?.artHash).not.toBeNull();
  });

  it('takes a year from the date tag, and refuses one that makes no sense', async () => {
    makeTone(lib('a.flac'), { frequency: 500, tags: { title: 'A', artist: 'X', date: '2003-04-05' } });
    makeTone(lib('b.flac'), { frequency: 510, tags: { title: 'B', artist: 'X', date: 'unknown' } });
    makeTone(lib('c.flac'), { frequency: 520, tags: { title: 'C', artist: 'X', date: '0000' } });
    await finishedScan(root, dbPath);
    expect(trackAt('New/a.flac')?.year).toBe(2003);
    expect(trackAt('New/b.flac')?.year).toBeNull();
    expect(trackAt('New/c.flac')?.year).toBeNull();
  });

  it('puts the same genre text in the same genre, whatever the codec', async () => {
    makeTone(lib('a.mp3'), { frequency: 500, tags: { title: 'A', artist: 'X', genre: 'Pop (indie)' } });
    makeTone(lib('b.flac'), { frequency: 510, tags: { title: 'B', artist: 'X', genre: 'Pop (indie)' } });
    await finishedScan(root, dbPath);
    const genre = queries.genres().find(({ name }) => name === 'Pop (indie)');
    expect(genre?.trackCount).toBe(2);
    expect(queries.genres().some(({ name }) => name === 'Pop')).toBe(false);
    expect(trackAt('New/a.mp3')?.genres).toEqual(['Pop (indie)']);
  });

  it('believes Vorbis over the stale tag blocks in a FLAC', async () => {
    const flac = lib('stale.flac');
    makeTone(flac, {
      frequency: 500,
      tags: { title: 'We Found Love', artist: 'Rihanna', album: 'Hits', track: '11', date: '1997' },
    });

    const frames = [
      ['TRCK', '03/14'],
      ['TPOS', '1/1'],
      ['TPE2', 'Someone Else'],
      ['TYER', '2007'],
    ].map(([id, value]) => {
      const text = Buffer.from(`\0${value}`, 'latin1');
      const size = Buffer.alloc(4);
      size.writeUInt32BE(text.length);
      return Buffer.concat([Buffer.from(id ?? '', 'latin1'), size, Buffer.alloc(2), text]);
    });
    const body = Buffer.concat(frames);
    const header = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, (body.length >> 7) & 0x7f, body.length & 0x7f]);
    const id3v1 = Buffer.alloc(128, 0);
    id3v1.write('TAG', 0, 'latin1');
    id3v1.write('2007', 93, 'latin1');
    writeFileSync(flac, Buffer.concat([header, body, readFileSync(flac), id3v1]));

    await finishedScan(root, dbPath);
    expect(trackAt('New/stale.flac')).toMatchObject({
      title: 'We Found Love',
      trackNumber: 11,
      discNumber: null,
      year: 1997,
      albumArtist: 'Rihanna',
    });
  });

  it('finds music in a folder whose name starts with a dot, and a move into one is still a move', async () => {
    makeTone(join(root, '...And Justice For All', '01 Blackened.flac'), {
      frequency: 500,
      tags: { title: 'Blackened', artist: 'Metallica' },
    });
    await finishedScan(root, dbPath);
    expect(trackAt('...And Justice For All/01 Blackened.flac')?.title).toBe('Blackened');

    const id = idOf(JOGA);
    mkdirSync(join(root, '.38 Special'));
    renameSync(at(JOGA), join(root, '.38 Special', 'moved.mp3'));
    const { report } = await finishedScan(root, dbPath);
    expect(report).toMatchObject({ moved: 1, nowMissing: 0 });
    expect(idOf('.38 Special/moved.mp3')).toBe(id);
  });
});

describe('art', () => {
  it('records embedded art, the same image once', async () => {
    await finishedScan(root, dbPath);
    const first = trackAt(FIRST);
    expect(first?.artHash).toMatch(/^[0-9a-f]{40}$/);
    expect(trackAt(SECOND)?.artHash).toBe(first?.artHash);
    expect(queries.artRow(first?.artHash ?? '')).toMatchObject({
      sourceKind: 'embedded',
      sourceRelPath: FIRST,
      mime: 'image/png',
    });
  });

  it('uses a folder image next to the file, or above a disc folder', async () => {
    await finishedScan(root, dbPath);
    const disc = trackAt(DISC_ONE);
    expect(disc?.artHash).toMatch(/^[0-9a-f]{40}$/);
    expect(trackAt('Artist One/Album B/CD2/01 Disc Two.flac')?.artHash).toBe(disc?.artHash);
    expect(queries.artRow(disc?.artHash ?? '')).toMatchObject({
      sourceKind: 'folder',
      sourceRelPath: 'Artist One/Album B/folder.jpg',
      mime: 'image/jpeg',
    });
  });

  it('ignores what Windows Media Player left behind', async () => {
    await finishedScan(root, dbPath);
    const sources = queries.artRows().map(({ sourceRelPath }) => sourceRelPath);
    expect(sources.some((source) => /AlbumArt/.test(source))).toBe(false);
  });

  it('prefers embedded art over a folder image', async () => {
    makeImage(join(root, 'Artist One', 'Album A', 'folder.jpg'), 'purple');
    await finishedScan(root, dbPath);
    expect(queries.artRow(trackAt(FIRST)?.artHash ?? '')?.sourceKind).toBe('embedded');
  });

  it('has no art where there is none', async () => {
    await finishedScan(root, dbPath);
    expect(trackAt('The Beatles/Single.mp3')?.artHash).toBeNull();
  });

  it('notices a folder image that arrives, changes or goes, with the audio untouched', async () => {
    const single = 'The Beatles/Single.mp3';
    const image = join(root, 'The Beatles', 'cover.png');
    await finishedScan(root, dbPath);
    expect(trackAt(single)?.artHash).toBeNull();

    makeImage(image, 'orange');
    await finishedScan(root, dbPath);
    const arrived = trackAt(single)?.artHash;
    expect(arrived).toMatch(/^[0-9a-f]{40}$/);

    makeImage(image, 'pink');
    await finishedScan(root, dbPath);
    const changed = trackAt(single)?.artHash;
    expect(changed).toMatch(/^[0-9a-f]{40}$/);
    expect(changed).not.toBe(arrived);
    expect(queries.artRow(arrived ?? '')).toBeNull();

    rmSync(image);
    await finishedScan(root, dbPath);
    expect(trackAt(single)?.artHash).toBeNull();
    expect(queries.artRow(changed ?? '')).toBeNull();
  });

  describe('when one image is embedded in one file and sits in another folder', () => {
    let cover: string;
    const inFolder = 'A Folder Image/x.flac';
    const embedded = 'B Embedded/01.flac';

    beforeEach(() => {
      cover = join(root, 'A Folder Image', 'cover.png');
      makeImage(cover, 'teal');
      makeTone(at(inFolder), { frequency: 2300, tags: { title: 'X', artist: 'Y', album: 'Folder Album' } });
      makeTone(at(embedded), {
        frequency: 2400,
        picture: cover,
        tags: { title: 'E', artist: 'Y', album: 'Embedded Album' },
      });
    });

    const albumArt = (title: string) =>
      queries.albums({ artistId: null, genreId: null }).find((album) => album.title === title)?.artHash;

    it('leaves the embedded art alone, however often it scans', async () => {
      await finishedScan(root, dbPath);
      const hash = trackAt(inFolder)?.artHash;
      expect(hash).toMatch(/^[0-9a-f]{40}$/);
      expect(trackAt(embedded)?.artHash).toBe(hash);
      expect(albumArt('Embedded Album')).toBe(hash);

      await finishedScan(root, dbPath);
      expect(trackAt(embedded)?.artHash).toBe(hash);
      expect(albumArt('Embedded Album')).toBe(hash);
    });

    it('notices the folder image going, whichever file was seen first', async () => {
      await finishedScan(root, dbPath);
      const hash = trackAt(embedded)?.artHash;

      rmSync(cover);
      await finishedScan(root, dbPath);

      expect(trackAt(inFolder)?.artHash).toBeNull();
      expect(albumArt('Folder Album')).toBeNull();
      expect(trackAt(embedded)?.artHash).toBe(hash);
      expect(albumArt('Embedded Album')).toBe(hash);
    });
  });

  describe('where a folder image came from', () => {
    const FOLDER_ART_TRACK = 'Artist One/Album B/CD1/01 Disc One.flac';

    it('follows the folder when it is renamed', async () => {
      await finishedScan(root, dbPath);
      const hash = trackAt(FOLDER_ART_TRACK)?.artHash ?? '';

      renameSync(join(root, 'Artist One', 'Album B'), join(root, 'Artist One', 'Renamed'));
      const { report } = await finishedScan(root, dbPath);

      expect(report.moved).toBe(2);
      expect(trackAt('Artist One/Renamed/CD1/01 Disc One.flac')?.artHash).toBe(hash);
      expect(queries.artRow(hash)?.sourceRelPath).toBe('Artist One/Renamed/folder.jpg');
    });

    it('moves on to a folder that still has it when the one it was read from goes', async () => {
      cpSync(join(root, 'Artist One', 'Album B', 'folder.jpg'), join(root, 'The Beatles', 'folder.jpg'));
      await finishedScan(root, dbPath);
      const hash = trackAt('The Beatles/Single.mp3')?.artHash ?? '';
      expect(hash).toBe(trackAt(FOLDER_ART_TRACK)?.artHash);

      const source = queries.artRow(hash)?.sourceRelPath ?? '';
      const survivor = source.startsWith('The Beatles') ? 'Artist One/Album B/folder.jpg' : 'The Beatles/folder.jpg';
      rmSync(at(source));
      await finishedScan(root, dbPath);

      expect(queries.artRow(hash)?.sourceRelPath).toBe(survivor);
      expect(queries.artRow(hash)?.sourceKind).toBe('folder');
    });

    it('marks nothing as changed for keeping its source up to date', async () => {
      await finishedScan(root, dbPath, { hostname: 'first', now: () => 1000 });
      await finishedScan(root, dbPath, { hostname: 'second', now: () => 2000 });
      expect(createLibraryMeta(db).lastChanged()).toEqual({ host: 'first', at: 1000 });
    });
  });

  describe('when a folder image cannot be read', () => {
    const IMAGE = 'Artist One/Album B/folder.jpg';
    const user = process.env.USERNAME ?? 'Everyone';

    function denyReading(path: string): () => void {
      execFileSync('icacls', [path, '/deny', `${user}:(R)`], { windowsHide: true, stdio: 'ignore' });
      return () => execFileSync('icacls', [path, '/remove:d', user], { windowsHide: true, stdio: 'ignore' });
    }

    it('keeps the art, says so, and counts nothing as changed', async () => {
      await finishedScan(root, dbPath, { hostname: 'first', now: () => 1000 });
      const hash = trackAt(DISC_ONE)?.artHash ?? '';
      const album = () =>
        queries.albums({ artistId: null, genreId: null }).find(({ title }) => title === 'Album B')?.artHash;
      expect(album()).toBe(hash);

      const allow = denyReading(at(IMAGE));
      try {
        const { report } = await finishedScan(root, dbPath, { hostname: 'second', now: () => 2000 });
        expect(report.issues).toBe(4);
      } finally {
        allow();
      }

      expect(trackAt(DISC_ONE)?.artHash).toBe(hash);
      expect(album()).toBe(hash);
      expect(queries.artRow(hash)).not.toBeNull();
      expect(createLibraryMeta(db).lastChanged()).toEqual({ host: 'first', at: 1000 });
      expect(queries.issues()).toContainEqual(
        expect.objectContaining({
          relPath: IMAGE,
          kind: 'unreadable',
          message: expect.stringContaining('kept its art') as string,
        }),
      );

      const { report } = await finishedScan(root, dbPath);
      expect(report.issues).toBe(3);
      expect(trackAt(DISC_ONE)?.artHash).toBe(hash);
    });

    it('a file read again at the same moment keeps its art too', async () => {
      await finishedScan(root, dbPath);
      const hash = trackAt(DISC_ONE)?.artHash ?? '';

      retag(at(DISC_ONE), { title: 'Retagged', artist: 'Artist One', album: 'Album B' });
      const allow = denyReading(at(IMAGE));
      try {
        await finishedScan(root, dbPath);
      } finally {
        allow();
      }

      expect(trackAt(DISC_ONE)).toMatchObject({ title: 'Retagged', artHash: hash });
    });
  });

  it('takes a drive going away during writing for just that, and clears no art', async () => {
    await finishedScan(root, dbPath);
    const hash = trackAt(DISC_ONE)?.artHash;
    const away = `${root}-away`;

    const outcome = await scan(root, dbPath, {
      onProgress: ({ phase }) => {
        if (phase === 'writing') renameSync(root, away);
      },
    });

    try {
      expect(outcome.kind).toBe('root-unreadable');
      expect(trackAt(DISC_ONE)?.artHash).toBe(hash);
      expect(queries.counts().missing).toBe(0);
    } finally {
      renameSync(away, root);
    }
  });
});

describe('an unchanged rescan', () => {
  it('reads nothing again and writes no change', async () => {
    await finishedScan(root, dbPath, { hostname: 'first', now: () => 1000 });
    const ids = allTrackRows();
    const { report } = await finishedScan(root, dbPath, { hostname: 'second', now: () => 2000 });
    expect(report).toMatchObject({
      added: 0,
      updated: 0,
      moved: 0,
      restored: 0,
      nowMissing: 0,
      unchanged: BASE_FILES_READABLE,
    });
    expect(allTrackRows()).toEqual(ids);

    const meta = createLibraryMeta(db);
    expect(meta.lastChanged()).toEqual({ host: 'first', at: 1000 });
    expect(meta.lastScanAt()).toBe(2000);
    expect(db.prepare('SELECT MAX(scanned_at) AS last FROM files').get()).toEqual({ last: 1000 });
  });

  it('keeps reporting what it knows is wrong', async () => {
    await finishedScan(root, dbPath);
    const first = queries.issues();
    const { report } = await finishedScan(root, dbPath);
    expect(queries.issues()).toEqual(first);
    expect(report.issues).toBe(first.length);
    expect(first.map(({ kind }) => kind).toSorted()).toEqual(['bad_tags', 'no_audio', 'unreadable']);
  });
});

describe('a retag', () => {
  it('keeps the id and updates everything else', async () => {
    await finishedScan(root, dbPath);
    const id = idOf(FIRST);
    const playlist = addToPlaylist(id);

    retag(at(FIRST), { title: 'Renamed', artist: 'New Artist', album: 'New Album', date: '2020', genre: 'Metal' });
    const { report } = await finishedScan(root, dbPath);

    expect(report).toMatchObject({ updated: 1, added: 0, moved: 0, unchanged: BASE_FILES_READABLE - 1 });
    expect(idOf(FIRST)).toBe(id);
    expect(trackAt(FIRST)).toMatchObject({
      id,
      title: 'Renamed',
      artist: 'New Artist',
      album: 'New Album',
      year: 2020,
      genres: ['Metal'],
    });
    expect(playlistTrackIds(playlist)).toEqual([id]);
  });

  it('keeps search in step', async () => {
    await finishedScan(root, dbPath);
    retag(at(FIRST), { title: 'Zebra Crossing', artist: 'Artist One', album: 'Album A' });
    await finishedScan(root, dbPath);
    expect(queries.search('zebra').tracks.map(({ relPath }) => relPath)).toEqual([FIRST]);
    expect(queries.search('first').tracks).toEqual([]);
  });

  it('removes artists, albums and genres with no tracks left', async () => {
    await finishedScan(root, dbPath);
    const { artHash } = trackAt(JOGA) ?? {};
    retag(at(JOGA), { title: 'Jóga', artist: 'Someone Else', album: 'Another' });
    await finishedScan(root, dbPath);

    const artists = queries.artists().map(({ name }) => name);
    expect(artists).toContain('Someone Else');
    expect(artists).not.toContain('Björk');
    expect(db.prepare("SELECT 1 FROM artists WHERE name = 'Björk'").get()).toBeUndefined();
    expect(db.prepare("SELECT 1 FROM albums WHERE title = 'Homogenic'").get()).toBeUndefined();
    // The retag was a stream copy with every stream kept, so the picture is still there.
    expect(trackAt(JOGA)?.artHash).toBe(artHash);
  });

  it('removes genres with no tracks left', async () => {
    await finishedScan(root, dbPath);
    expect(queries.genres().map(({ name }) => name)).toContain('Jazz');
    retag(at(DISC_ONE), { title: 'Disc One', artist: 'Artist One', album: 'Album B', disc: '1', track: '1' });
    await finishedScan(root, dbPath);
    expect(queries.genres().map(({ name }) => name)).not.toContain('Jazz');
  });

  it('clears a bad_tags issue when the file gets a title', async () => {
    await finishedScan(root, dbPath);
    retag(at('No Tags/untagged.flac'), { title: 'Now Tagged' });
    await finishedScan(root, dbPath);
    expect(queries.issues().filter(({ kind }) => kind === 'bad_tags')).toEqual([]);
  });

  it('counts as a change to the library', async () => {
    await finishedScan(root, dbPath, { hostname: 'first', now: () => 1000 });
    retag(at(FIRST), { title: 'Renamed' });
    await finishedScan(root, dbPath, { hostname: 'second', now: () => 2000 });
    expect(createLibraryMeta(db).lastChanged()).toEqual({ host: 'second', at: 2000 });
  });
});

describe('a move', () => {
  it('keeps the id, and with it the playlists', async () => {
    await finishedScan(root, dbPath);
    const id = idOf(FIRST);
    const playlist = addToPlaylist(id);

    mkdirSync(join(root, 'Elsewhere'));
    renameSync(at(FIRST), join(root, 'Elsewhere', 'moved.flac'));
    const { report } = await finishedScan(root, dbPath);

    expect(report).toMatchObject({ moved: 1, added: 0, nowMissing: 0, updated: 0 });
    expect(idOf('Elsewhere/moved.flac')).toBe(id);
    expect(trackAt('Elsewhere/moved.flac')).toMatchObject({ id, title: 'First', isMissing: false });
    expect(playlistTrackIds(playlist)).toEqual([id]);
    expect(allTrackRows().some(({ relPath }) => relPath === FIRST)).toBe(false);
  });

  it('recognizes an MP3 by its frames', async () => {
    await finishedScan(root, dbPath);
    const id = idOf(JOGA);
    renameSync(at(JOGA), join(root, 'renamed.mp3'));
    const { report } = await finishedScan(root, dbPath);
    expect(report.moved).toBe(1);
    expect(idOf('renamed.mp3')).toBe(id);
  });

  it('picks up new tags at the same time', async () => {
    await finishedScan(root, dbPath);
    const id = idOf(FIRST);
    retag(at(FIRST), { title: 'Moved And Retagged', artist: 'Artist One', album: 'Album A' });
    renameSync(at(FIRST), join(root, 'moved.flac'));
    const { report } = await finishedScan(root, dbPath);
    expect(report).toMatchObject({ moved: 1, added: 0 });
    expect(trackAt('moved.flac')).toMatchObject({ id, title: 'Moved And Retagged' });
  });

  it('follows the art source', async () => {
    await finishedScan(root, dbPath);
    rmSync(at(SECOND));
    renameSync(at(FIRST), join(root, 'moved.flac'));
    await finishedScan(root, dbPath);
    const hash = trackAt('moved.flac')?.artHash ?? '';
    expect(queries.artRow(hash)?.sourceRelPath).toBe('moved.flac');
  });

  it('still finds a move a scan later', async () => {
    await finishedScan(root, dbPath);
    const id = idOf(JOGA);
    const away = join(data, 'away.mp3');
    renameSync(at(JOGA), away);
    await finishedScan(root, dbPath);
    expect(allTrackRows().find((row) => row.id === id)?.missingSince).not.toBeNull();

    renameSync(away, join(root, 'back in another place.mp3'));
    const { report } = await finishedScan(root, dbPath);
    expect(report.moved).toBe(1);
    expect(trackAt('back in another place.mp3')).toMatchObject({ id, isMissing: false });
  });

  it('does not hash new files when nothing is gone', async () => {
    await finishedScan(root, dbPath);
    makeTone(join(root, 'brand new.flac'), { frequency: 1800, tags: { title: 'New' } });
    const { report } = await finishedScan(root, dbPath);
    expect(report).toMatchObject({ added: 1, moved: 0 });
    expect(db.prepare("SELECT audio_hash AS hash FROM files WHERE rel_path = 'brand new.flac'").get()).toEqual({
      hash: expect.stringMatching(/^flac-md5:/) as string,
    });
  });
});

describe('a file whose path was already on record', () => {
  const FIRST_PATH = 'Same/one.flac';
  const SECOND_PATH = 'Same/two.flac';
  let one: number;
  let two: number;

  beforeEach(async () => {
    makeTone(at(FIRST_PATH), { frequency: 2500, seconds: 0.4, tags: { title: 'One' } });
    makeTone(at(SECOND_PATH), { frequency: 2600, seconds: 0.8, tags: { title: 'Two' } });
    await finishedScan(root, dbPath);
    one = idOf(FIRST_PATH);
    two = idOf(SECOND_PATH);
  });

  it('two names swapped: each id stays with its recording', async () => {
    const playlist = addToPlaylist(one);
    const parked = at('Same/parked');
    renameSync(at(FIRST_PATH), parked);
    renameSync(at(SECOND_PATH), at(FIRST_PATH));
    renameSync(parked, at(SECOND_PATH));

    const { report } = await finishedScan(root, dbPath);

    expect(report).toMatchObject({ moved: 2, updated: 0, added: 0, nowMissing: 0 });
    expect(trackAt(SECOND_PATH)).toMatchObject({ id: one, title: 'One', isMissing: false });
    expect(trackAt(FIRST_PATH)).toMatchObject({ id: two, title: 'Two', isMissing: false });
    expect(playlistTrackIds(playlist)).toEqual([one]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  });

  it('moved onto a path that had gone: the audio keeps its id, and the id it replaced goes missing', async () => {
    const playlist = addToPlaylist(one);
    rmSync(at(FIRST_PATH));
    renameSync(at(SECOND_PATH), at(FIRST_PATH));

    const { report } = await finishedScan(root, dbPath);

    expect(report).toMatchObject({ moved: 1, nowMissing: 1, updated: 0, added: 0 });
    expect(trackAt(FIRST_PATH)).toMatchObject({ id: two, title: 'Two' });
    expect(queries.tracks({ kind: 'missing' }).map(({ id }) => id)).toEqual([one]);
    expect(queries.tracksByIds([one])[0]).toMatchObject({ title: 'One', isMissing: true });
    expect(playlistTrackIds(playlist)).toEqual([one]);
  });

  it('the row that gave up its path comes back when its audio does, wherever that is', async () => {
    const original = join(data, 'one again.flac');
    copyFileSync(at(FIRST_PATH), original);
    rmSync(at(FIRST_PATH));
    renameSync(at(SECOND_PATH), at(FIRST_PATH));
    await finishedScan(root, dbPath);

    renameSync(original, join(root, 'back.flac'));
    const { report } = await finishedScan(root, dbPath);

    expect(report).toMatchObject({ moved: 1, nowMissing: 0 });
    expect(trackAt('back.flac')).toMatchObject({ id: one, title: 'One', isMissing: false });
    expect(trackAt(FIRST_PATH)).toMatchObject({ id: two });
  });

  it('nothing new can ever be found at the path a row gave up', async () => {
    rmSync(at(FIRST_PATH));
    renameSync(at(SECOND_PATH), at(FIRST_PATH));
    await finishedScan(root, dbPath);

    makeTone(at(SECOND_PATH), { frequency: 2700, seconds: 1.1, tags: { title: 'Brand New' } });
    const { report } = await finishedScan(root, dbPath);

    expect(report).toMatchObject({ added: 1, updated: 0 });
    expect(trackAt(SECOND_PATH)).toMatchObject({ title: 'Brand New' });
    expect([one, two]).not.toContain(idOf(SECOND_PATH));
  });

  it('other audio at the same path that matches nothing just updates that row, as it always has', async () => {
    makeTone(at(FIRST_PATH), { frequency: 2800, seconds: 1.2, tags: { title: 'Replaced' } });
    makeTone(at(SECOND_PATH), { frequency: 2600, seconds: 0.8, tags: { title: 'Two again' } });

    const { report } = await finishedScan(root, dbPath);

    expect(report).toMatchObject({ updated: 2, moved: 0, added: 0, nowMissing: 0 });
    expect(trackAt(FIRST_PATH)).toMatchObject({ id: one, title: 'Replaced' });
    expect(trackAt(SECOND_PATH)).toMatchObject({ id: two, title: 'Two again' });
  });

  it('a retag of several files at once hashes them, and keeps every id', async () => {
    retag(at(FIRST_PATH), { title: 'One retagged' });
    retag(at(SECOND_PATH), { title: 'Two retagged' });

    const { report } = await finishedScan(root, dbPath);

    expect(report).toMatchObject({ updated: 2, moved: 0 });
    expect(trackAt(FIRST_PATH)).toMatchObject({ id: one, title: 'One retagged' });
    expect(trackAt(SECOND_PATH)).toMatchObject({ id: two, title: 'Two retagged' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM files WHERE audio_hash IS NULL').get()).toEqual({ n: 0 });
  });
});

describe('a case-only rename', () => {
  it('updates the stored path and keeps the id, without calling it a move', async () => {
    await finishedScan(root, dbPath);
    const id = idOf(FIRST);
    const before = at(FIRST);
    const respelled = 'Artist One/Album A/01 FIRST.FLAC';
    renameSync(before, `${before}.tmp`);
    renameSync(`${before}.tmp`, at(respelled));

    const { report } = await finishedScan(root, dbPath);
    expect(report).toMatchObject({ moved: 0, added: 0, nowMissing: 0, updated: 0, unchanged: BASE_FILES_READABLE });
    expect(idOf(respelled)).toBe(id);
    expect(allTrackRows().some(({ relPath }) => relPath === FIRST)).toBe(false);
  });

  it('also follows a folder that changed case', async () => {
    await finishedScan(root, dbPath);
    const id = idOf(JOGA);
    renameSync(join(root, 'Björk'), join(root, 'tmp-name'));
    renameSync(join(root, 'tmp-name'), join(root, 'BJÖRK'));
    const { report } = await finishedScan(root, dbPath);
    expect(report).toMatchObject({ moved: 0, added: 0, nowMissing: 0 });
    expect(idOf('BJÖRK/Homogenic/Jóga.mp3')).toBe(id);
  });
});

describe('a deleted file', () => {
  it('is marked missing, and stays in the playlists', async () => {
    await finishedScan(root, dbPath);
    const id = idOf(SECOND);
    const playlist = addToPlaylist(id);

    rmSync(at(SECOND));
    const { report } = await finishedScan(root, dbPath);

    expect(report).toMatchObject({ nowMissing: 1, moved: 0, added: 0 });
    expect(playlistTrackIds(playlist)).toEqual([id]);
    expect(queries.tracks({ kind: 'all' }).some((track) => track.id === id)).toBe(false);
    expect(queries.tracks({ kind: 'missing' }).map((track) => track.id)).toEqual([id]);
    expect(queries.tracksByIds([id])[0]).toMatchObject({ id, isMissing: true, title: 'Second' });
    expect(queries.counts().missing).toBe(1);
  });

  it('is not counted again by the next scan, and keeps its first date', async () => {
    await finishedScan(root, dbPath);
    rmSync(at(SECOND));
    await finishedScan(root, dbPath, { now: () => 1000 });
    const { report } = await finishedScan(root, dbPath, { now: () => 2000 });
    expect(report.nowMissing).toBe(0);
    expect(db.prepare('SELECT missing_since AS since FROM files WHERE missing_since IS NOT NULL').get()).toEqual({
      since: 1000,
    });
  });

  it('keeps the album while any of its tracks is there, and hides it after', async () => {
    await finishedScan(root, dbPath);
    rmSync(at(SECOND));
    await finishedScan(root, dbPath);
    const album = queries.albums({ artistId: null, genreId: null }).find(({ title }) => title === 'Album A');
    expect(album?.trackCount).toBe(1);

    rmSync(at(FIRST));
    await finishedScan(root, dbPath);
    expect(queries.albums({ artistId: null, genreId: null }).some(({ title }) => title === 'Album A')).toBe(false);
    expect(db.prepare("SELECT 1 FROM albums WHERE title = 'Album A'").get()).toBeDefined();
    expect(allTrackRows().filter(({ missingSince }) => missingSince !== null)).toHaveLength(2);
  });

  it('comes back by itself when the file returns', async () => {
    await finishedScan(root, dbPath);
    const id = idOf(SECOND);
    const away = join(data, 'away.flac');
    const { mtime } = statSync(at(SECOND));
    renameSync(at(SECOND), away);
    await finishedScan(root, dbPath);

    renameSync(away, at(SECOND));
    utimesSync(at(SECOND), mtime, mtime);
    const { report } = await finishedScan(root, dbPath);

    expect(report).toMatchObject({ restored: 1, nowMissing: 0, added: 0, moved: 0 });
    expect(trackAt(SECOND)).toMatchObject({ id, isMissing: false });
    expect(queries.tracks({ kind: 'missing' })).toEqual([]);
  });

  it('comes back with new tags too, when it was changed while it was away', async () => {
    await finishedScan(root, dbPath);
    const id = idOf(SECOND);
    const away = join(data, 'away.flac');
    renameSync(at(SECOND), away);
    await finishedScan(root, dbPath);

    retag(away, { title: 'Changed While Away', artist: 'Artist One', album: 'Album A' });
    renameSync(away, at(SECOND));
    const { report } = await finishedScan(root, dbPath);

    expect(report).toMatchObject({ restored: 1, updated: 0, nowMissing: 0 });
    expect(trackAt(SECOND)).toMatchObject({ id, isMissing: false, title: 'Changed While Away' });
  });
});

describe('duplicates', () => {
  it('never matches a new file to two gone rows with its hash', async () => {
    copyFileSync(at(JOGA), join(root, 'copy of joga.mp3'));
    await finishedScan(root, dbPath);
    const originals = [idOf(JOGA), idOf('copy of joga.mp3')];

    const third = join(data, 'third.mp3');
    copyFileSync(at(JOGA), third);
    rmSync(at(JOGA));
    rmSync(join(root, 'copy of joga.mp3'));
    renameSync(third, join(root, 'third.mp3'));

    const { report } = await finishedScan(root, dbPath);
    expect(report).toMatchObject({ moved: 0, added: 1, nowMissing: 2 });
    expect(originals).not.toContain(idOf('third.mp3'));
    expect(
      allTrackRows()
        .filter(({ missingSince }) => missingSince !== null)
        .map(({ id }) => id)
        .toSorted(),
    ).toEqual(originals.toSorted());
  });

  it('gives a gone row to the first of several new copies, and adds the others', async () => {
    await finishedScan(root, dbPath);
    const id = idOf(JOGA);
    copyFileSync(at(JOGA), join(root, 'z copy.mp3'));
    copyFileSync(at(JOGA), join(root, 'a copy.mp3'));
    rmSync(at(JOGA));

    const { report } = await finishedScan(root, dbPath);
    expect(report).toMatchObject({ moved: 1, added: 1, nowMissing: 0 });
    expect(idOf('a copy.mp3')).toBe(id);
    expect(idOf('z copy.mp3')).not.toBe(id);
  });

  it('adds a copy of a file that is still there', async () => {
    await finishedScan(root, dbPath);
    const id = idOf(JOGA);
    copyFileSync(at(JOGA), join(root, 'copy.mp3'));
    const { report } = await finishedScan(root, dbPath);
    expect(report).toMatchObject({ added: 1, moved: 0 });
    expect(idOf(JOGA)).toBe(id);
  });
});

describe('cancelling', () => {
  /** A clock that moves on with every look, so progress isn't throttled and every file is reported. */
  function eagerClock() {
    let time = 0;
    return () => (time += 1000);
  }

  it.each(['reading', 'hashing'] as const)('marks nothing missing when stopped while %s', async (when) => {
    await finishedScan(root, dbPath);
    rmSync(at(SECOND));
    makeTone(join(root, 'one.flac'), { frequency: 1600, tags: { title: 'One' } });
    makeTone(join(root, 'two.flac'), { frequency: 1700, tags: { title: 'Two' } });
    retag(at(FIRST), { title: 'First Again' });
    const issues = queries.issues();

    let phase = '';
    const outcome = await scan(root, dbPath, {
      isCancelled: () => phase === when,
      onProgress: (progress) => {
        phase = progress.phase;
      },
    });

    expect(outcome).toMatchObject({ kind: 'cancelled', report: { cancelled: true, nowMissing: 0 } });
    expect(allTrackRows().filter(({ missingSince }) => missingSince !== null)).toEqual([]);
    expect(queries.issues()).toEqual(issues);
  });

  it('picks up the hashing where it stopped', async () => {
    let phase = '';
    let hashed = 0;
    const outcome = await scan(root, dbPath, {
      now: eagerClock(),
      isCancelled: () => phase === 'hashing' && ++hashed > 2,
      onProgress: (progress) => {
        phase = progress.phase;
      },
    });
    expect(outcome.kind).toBe('cancelled');
    const unhashed = () =>
      db.prepare('SELECT COUNT(*) AS n FROM files WHERE audio_hash IS NULL').get() as { n: number };
    expect(unhashed().n).toBeGreaterThan(0);
    expect(unhashed().n).toBeLessThan(BASE_FILES_READABLE);

    const { report } = await finishedScan(root, dbPath);
    expect(report).toMatchObject({ added: 0, unchanged: BASE_FILES_READABLE });
    expect(unhashed().n).toBe(0);
  });

  it('gets through to a file while hashing it', async () => {
    const folder = tempDir('one-mp3');
    makeTone(join(folder, 'one.mp3'), { frequency: 1800, tags: { title: 'One' } });
    let phase = '';
    let looks = 0;
    const outcome = await scan(folder, dbPath, {
      // The first look is before the file, so the second is from inside it.
      isCancelled: () => phase === 'hashing' && ++looks > 1,
      onProgress: (progress) => {
        phase = progress.phase;
      },
    });
    expect(outcome.kind).toBe('cancelled');
    expect(db.prepare('SELECT COUNT(*) AS n FROM files WHERE audio_hash IS NULL').get()).toEqual({ n: 1 });
  });

  describe('while looking for moved files', () => {
    const MOVED = 'Moved/joga.mp3';

    function stoppedAt(relPath: string) {
      let isLooking = false;
      let looks = 0;
      const outcome = scan(root, dbPath, {
        now: eagerClock(),
        isCancelled: () => {
          if (isLooking) looks++;
          return isLooking;
        },
        onProgress: ({ currentPath }) => {
          isLooking ||= currentPath === relPath;
        },
      });
      return outcome.then(({ kind }) => ({ kind, looks }));
    }

    beforeEach(async () => {
      await finishedScan(root, dbPath);
      mkdirSync(at('Moved'));
    });

    it('gets through to a file while hashing it', async () => {
      renameSync(at(JOGA), at(MOVED));
      // Once from inside the file, and once on the way out.
      expect(await stoppedAt(MOVED)).toEqual({ kind: 'cancelled', looks: 2 });
    });

    it('makes nothing of a hunt that was stopped before its end', async () => {
      const ids = [idOf(FIRST), idOf(SECOND)];
      renameSync(at(FIRST), at('Moved/1.flac'));
      renameSync(at(SECOND), at('Moved/2.flac'));

      expect(await stoppedAt('Moved/2.flac')).toMatchObject({ kind: 'cancelled' });
      expect([idOf(FIRST), idOf(SECOND)]).toEqual(ids);
    });
  });

  it('can stop during the walk', async () => {
    const outcome = await scan(root, dbPath, { isCancelled: () => true });
    expect(outcome).toMatchObject({ kind: 'cancelled', report: { cancelled: true, added: 0 } });
    expect(allTrackRows()).toEqual([]);
  });

  it('leaves the last report of issues alone', async () => {
    await finishedScan(root, dbPath);
    const issues = queries.issues();
    await scan(root, dbPath, { isCancelled: () => true });
    expect(queries.issues()).toEqual(issues);
  });

  it('commits what it read, and a later scan just continues', async () => {
    let read = 0;
    const outcome = await scan(root, dbPath, {
      now: eagerClock(),
      isCancelled: () => read >= 3,
      onProgress: ({ phase, filesDone }) => {
        if (phase === 'reading') read = filesDone;
      },
    });
    expect(outcome.kind).toBe('cancelled');

    const partial = allTrackRows();
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan(BASE_FILES_READABLE);

    const { report } = await finishedScan(root, dbPath);
    expect(report.unchanged).toBe(partial.length);
    expect(report.added).toBe(BASE_FILES_READABLE - partial.length);
    for (const { id, relPath } of partial) expect(idOf(relPath)).toBe(id);
  });

  it('files that came back in a scan that was stopped still put their album right, a scan later', async () => {
    await finishedScan(root, dbPath);
    const album = () =>
      queries.albums({ artistId: null, genreId: null }).find(({ title }) => title === 'Album A') ?? null;
    const before = album();
    expect(before).toMatchObject({ year: 2001, artHash: expect.any(String) as string });

    const folder = join(root, 'Artist One', 'Album A');
    const away = join(data, 'album a');
    cpSync(folder, away, { recursive: true, preserveTimestamps: true });
    rmSync(folder, { recursive: true });
    await finishedScan(root, dbPath);
    expect(album()).toBeNull();

    cpSync(away, folder, { recursive: true, preserveTimestamps: true });
    let phase = '';
    const stopped = await scan(root, dbPath, {
      isCancelled: () => phase === 'hashing',
      onProgress: (progress) => {
        phase = progress.phase;
      },
    });
    expect(stopped.kind).toBe('cancelled');

    const { report } = await finishedScan(root, dbPath);
    expect(report).toMatchObject({ added: 0, updated: 0, restored: 0, nowMissing: 0 });
    expect(album()).toMatchObject({ year: 2001, artHash: before?.artHash, trackCount: 2 });
  });
});

describe('the guards', () => {
  const user = process.env.USERNAME ?? 'Everyone';

  function denyListing(path: string): () => void {
    execFileSync('icacls', [path, '/deny', `${user}:(RD)`], { windowsHide: true, stdio: 'ignore' });
    return () => execFileSync('icacls', [path, '/remove:d', user], { windowsHide: true, stdio: 'ignore' });
  }

  it('a folder that cannot be read protects everything under it, and is reported', async () => {
    await finishedScan(root, dbPath);
    const locked = join(root, 'Artist One');
    const unlock = denyListing(locked);
    try {
      const { report } = await finishedScan(root, dbPath);
      expect(report.nowMissing).toBe(0);
      expect(allTrackRows().filter(({ missingSince }) => missingSince !== null)).toEqual([]);
      expect(queries.issues()).toContainEqual(expect.objectContaining({ relPath: 'Artist One', kind: 'unreadable' }));
    } finally {
      unlock();
    }
    const { report } = await finishedScan(root, dbPath);
    expect(report).toMatchObject({ nowMissing: 0, added: 0, unchanged: BASE_FILES_READABLE });
  });

  it('a folder that cannot be read keeps its art and its known issues', async () => {
    await finishedScan(root, dbPath);
    const before = { art: trackAt(DISC_ONE)?.artHash, issues: queries.issues() };
    expect(before.art).toMatch(/^[0-9a-f]{40}$/);

    const unlock = denyListing(join(root, 'Artist One'));
    const unlockOther = denyListing(join(root, 'No Tags'));
    try {
      await finishedScan(root, dbPath);
    } finally {
      unlock();
      unlockOther();
    }
    expect(trackAt(DISC_ONE)?.artHash).toBe(before.art);
    expect(queries.issues()).toContainEqual(
      expect.objectContaining({ relPath: 'No Tags/untagged.flac', kind: 'bad_tags' }),
    );
  });

  it('a protected folder is not mistaken for moved files either', async () => {
    await finishedScan(root, dbPath);
    const id = idOf(FIRST);
    const unlock = denyListing(join(root, 'Artist One', 'Album A'));
    try {
      await finishedScan(root, dbPath);
    } finally {
      unlock();
    }
    expect(idOf(FIRST)).toBe(id);
    expect(allTrackRows().filter(({ missingSince }) => missingSince !== null)).toEqual([]);
  });

  it('a library folder that is gone aborts the scan and touches nothing', async () => {
    await finishedScan(root, dbPath);
    const rows = allTrackRows();
    const issues = queries.issues();
    const outcome = await scan(join(root, 'no such folder'), dbPath);
    expect(outcome.kind).toBe('root-unreadable');
    expect(allTrackRows()).toEqual(rows);
    expect(queries.issues()).toEqual(issues);
  });

  it('a library folder that cannot be read aborts the scan', async () => {
    await finishedScan(root, dbPath);
    const rows = allTrackRows();
    const unlock = denyListing(root);
    try {
      expect((await scan(root, dbPath)).kind).toBe('root-unreadable');
    } finally {
      unlock();
    }
    expect(allTrackRows()).toEqual(rows);
  });

  it('a folder with no audio at all marks nothing missing, and says it looks empty', async () => {
    await finishedScan(root, dbPath);
    const rows = allTrackRows();
    const art = trackAt(DISC_ONE)?.artHash;
    const empty = tempDir('empty-lib');
    const { report } = await finishedScan(empty, dbPath);
    expect(report.looksEmpty).toBe(true);
    expect(report.nowMissing).toBe(0);
    expect(allTrackRows()).toEqual(rows);
    expect(trackAt(DISC_ONE)?.artHash).toBe(art);
  });

  it('an empty folder and an empty database is just an empty library', async () => {
    const empty = tempDir('empty-lib');
    const { report } = await finishedScan(empty, dbPath);
    expect(report.looksEmpty).toBe(false);
    expect(report.issues).toBe(0);
  });
});

describe('bad files', () => {
  it('reports a file it cannot parse, keeps no row, and tries again next time', async () => {
    await finishedScan(root, dbPath);
    expect(allTrackRows().some(({ relPath }) => relPath === 'Broken/corrupt.flac')).toBe(false);
    expect(queries.issues()).toContainEqual(
      expect.objectContaining({ relPath: 'Broken/corrupt.flac', kind: 'unreadable' }),
    );

    makeTone(at('Broken/corrupt.flac'), { frequency: 1900, tags: { title: 'Fixed' } });
    const { report } = await finishedScan(root, dbPath);
    expect(report.added).toBe(1);
    expect(trackAt('Broken/corrupt.flac')?.title).toBe('Fixed');
    expect(queries.issues().some(({ relPath }) => relPath === 'Broken/corrupt.flac')).toBe(false);
  });

  it('calls an empty file no_audio', async () => {
    await finishedScan(root, dbPath);
    expect(queries.issues()).toContainEqual(expect.objectContaining({ relPath: 'Broken/empty.mp3', kind: 'no_audio' }));
    expect(allTrackRows().some(({ relPath }) => relPath === 'Broken/empty.mp3')).toBe(false);
  });

  it('calls a file with tags but no frames no_audio', async () => {
    const tagOnly = Buffer.concat([Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x0a', 'latin1'), Buffer.alloc(10)]);
    writeFileSync(join(root, 'Broken', 'tag-only.mp3'), tagOnly);
    await finishedScan(root, dbPath);
    expect(queries.issues()).toContainEqual(
      expect.objectContaining({ relPath: 'Broken/tag-only.mp3', kind: 'no_audio' }),
    );
  });

  it('calls a text file with a .mp3 name something it cannot use, without stopping', async () => {
    writeFileSync(join(root, 'Broken', 'text.mp3'), 'plain text, no frames in here'.repeat(100));
    const { report } = await finishedScan(root, dbPath);
    expect(report.added).toBe(BASE_FILES_READABLE);
    expect(queries.issues().some(({ relPath }) => relPath === 'Broken/text.mp3')).toBe(true);
  });

  it('keeps the row of a file that went bad, and tries it again', async () => {
    await finishedScan(root, dbPath);
    const id = idOf(FIRST);
    const before = trackAt(FIRST);
    const good = join(data, 'good.flac');
    copyFileSync(at(FIRST), good);

    writeFileSync(at(FIRST), 'damaged');
    const damaged = await finishedScan(root, dbPath);
    expect(damaged.report.updated).toBe(0);
    expect(trackAt(FIRST)).toEqual(before);
    expect(queries.issues().some(({ relPath }) => relPath === FIRST)).toBe(true);

    copyFileSync(good, at(FIRST));
    utimesSync(at(FIRST), new Date(), new Date());
    const { report } = await finishedScan(root, dbPath);
    expect(report.updated).toBe(1);
    expect(idOf(FIRST)).toBe(id);
  });

  it('does not follow a junction', async () => {
    const outside = tempDir('outside');
    makeTone(join(outside, 'outside.flac'), { frequency: 2000, tags: { title: 'Outside' } });
    symlinkSync(outside, join(root, 'Linked'), 'junction');

    const { report } = await finishedScan(root, dbPath);
    expect(report.added).toBe(BASE_FILES_READABLE);
    expect(allTrackRows().some(({ relPath }) => relPath.includes('outside'))).toBe(false);
    expect(queries.issues()).toContainEqual({
      relPath: 'Linked',
      kind: 'unreadable',
      message: expect.stringContaining("links aren't followed") as string,
    });
  });

  it('does not mistake what is behind a new link for gone', async () => {
    await finishedScan(root, dbPath);
    const album = join(root, 'Artist One', 'Album A');
    const away = join(data, 'moved album');
    copyFileSync(at(FIRST), join(data, 'first.flac'));
    mkdirSync(away);
    renameSync(at(FIRST), join(away, '01 First.flac'));
    renameSync(at(SECOND), join(away, '02 Second.flac'));
    rmSync(album, { recursive: true });
    symlinkSync(away, album, 'junction');

    const { report } = await finishedScan(root, dbPath);
    expect(report.nowMissing).toBe(0);
    expect(allTrackRows().filter(({ missingSince }) => missingSince !== null)).toEqual([]);
  });

  it('one row the database refuses is one issue, and the rest of the batch goes in', async () => {
    db.exec(`CREATE TRIGGER refuse BEFORE INSERT ON files WHEN NEW.rel_path LIKE '%Single%'
             BEGIN SELECT RAISE(ABORT, 'refused'); END`);
    const { report } = await finishedScan(root, dbPath);

    expect(report.added).toBe(BASE_FILES_READABLE - 1);
    expect(trackAt('The Beatles/Single.mp3')).toBeUndefined();
    expect(trackAt(FIRST)).toBeDefined();
    expect(queries.issues()).toContainEqual({
      relPath: 'The Beatles/Single.mp3',
      kind: 'unreadable',
      message: expect.stringContaining('refused') as string,
    });

    db.exec('DROP TRIGGER refuse');
    const again = await finishedScan(root, dbPath);
    expect(again.report).toMatchObject({ added: 1, unchanged: BASE_FILES_READABLE - 1 });
    expect(trackAt('The Beatles/Single.mp3')).toBeDefined();
  });

  it('a failure that is not about one row still ends the scan', async () => {
    db.exec(`CREATE TRIGGER broken BEFORE INSERT ON files BEGIN SELECT no_such_function(); END`);
    await expect(finishedScan(root, dbPath)).rejects.toThrow();
  });

  it('saves a file whose header makes no sense, instead of stopping everything for it', async () => {
    const aiff = Buffer.alloc(54);
    aiff.write('FORM', 0, 'latin1');
    aiff.writeUInt32BE(46, 4);
    aiff.write('AIFF', 8, 'latin1');
    aiff.write('COMM', 12, 'latin1');
    aiff.writeUInt32BE(18, 16);
    aiff.writeUInt16BE(2, 20);
    aiff.writeUInt16BE(16, 26);
    aiff.write('SSND', 38, 'latin1');
    aiff.writeUInt32BE(8, 42);
    writeFileSync(join(root, 'Broken', 'zero.aiff'), aiff);

    const { report } = await finishedScan(root, dbPath);
    expect(report.added).toBeGreaterThanOrEqual(BASE_FILES_READABLE);
    expect(db.prepare('SELECT COUNT(*) AS n FROM files WHERE duration_ms = duration_ms + 1').get()).toEqual({ n: 0 });
    expect(trackAt(FIRST)).toBeDefined();
  });

  it('survives a scan_issues replacement that finds nothing wrong', async () => {
    await finishedScan(root, dbPath);
    rmSync(join(root, 'Broken'), { recursive: true });
    rmSync(join(root, 'No Tags'), { recursive: true });
    const { report } = await finishedScan(root, dbPath);
    expect(report.issues).toBe(0);
    expect(queries.issues()).toEqual([]);
  });
});
