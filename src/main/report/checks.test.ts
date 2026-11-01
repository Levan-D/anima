import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from '@main/db/connection';
import { readFileFacts } from '@main/library/fileFacts';
import { createLibraryWrites } from '@main/library/queries';
import { createScanWriter, type ReadFile } from '@main/library/scanWriter';
import { closeTestDatabase, ffmpeg, makeTone, openTestDatabase, retag, tempDir } from '@main/library/testFixtures';
import { FINGERPRINT_MODEL } from '@main/fingerprints/model';
import { artistKey, titleKey } from '@main/library/names';
import { buildReport, checkById, createReportQueries, REPORT_GROUPS, type ReportQueries } from './checks';
import { fillFileFacts } from './jobs';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let db: Connection;
let queries: ReportQueries;
let writer: ReturnType<typeof createScanWriter>;
let nextPath = 1;

type Song = Partial<ReadFile['tags']> & {
  path?: string;
  codec?: string;
  isLossless?: boolean;
  sizeBytes?: number;
  durationMs?: number;
  sampleRate?: number;
  bitDepth?: number;
  art?: string | null;
  hash?: string | null;
  facts?: Partial<ReadFile['facts']>;
};

function song({
  path,
  codec = 'FLAC',
  isLossless = true,
  sizeBytes = 40_000_000,
  durationMs = 200_000,
  sampleRate = 44_100,
  bitDepth = 16,
  art = 'cover',
  hash,
  facts,
  ...tags
}: Song): ReadFile {
  const relPath = path ?? `file ${nextPath++}.flac`;
  return {
    id: null,
    found: { relPath, sizeBytes, mtimeMs: 1 },
    audioHash: hash === undefined ? `flac-md5:${relPath}` : hash,
    tags: {
      title: relPath,
      titleIsFileName: false,
      artist: 'Someone',
      albumArtist: 'Someone',
      album: 'Album',
      year: 2000,
      discNumber: null,
      trackNumber: nextPath++,
      genres: ['Rock'],
      ...tags,
    },
    format: { codec, isLossless, sampleRate, bitDepth, channels: 2, durationMs },
    facts: { hasReplayGain: true, hasAlbumArtist: true, hasGaplessHeader: null, ...facts },
    art: art === null ? null : { hash: art, kind: 'embedded', relPath, mime: 'image/jpeg' },
    keepArt: false,
    cue: null,
  };
}

function add(...songs: Song[]): void {
  writer.commit(songs.map(song));
}

function count(id: string): number {
  return queries.stored().counts[id] ?? -1;
}

function titlesOf(id: string): string[] {
  const check = checkById(id);
  if (check === null) throw new Error(id);
  const byId = new Map(
    db
      .prepare<[], { id: number; title: string }>('SELECT id, title FROM tracks')
      .all()
      .map((row) => [row.id, row.title]),
  );
  return queries.trackIds(check).map((trackId) => byId.get(trackId) ?? '');
}

beforeEach(() => {
  ({ db } = openTestDatabase(tempDir('report')));
  writer = createScanWriter(db, { now: () => 1, hostname: 'here' });
  queries = createReportQueries(db);
});

afterEach(() => closeTestDatabase(db));

describe('the checks', () => {
  it('every one runs and has a unique id', () => {
    const ids = REPORT_GROUPS.flatMap(({ checks }) => checks.map(({ id }) => id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(queries.stored().counts).toSorted()).toEqual(ids.toSorted());
  });

  it('finds lossy files with the lowest bitrate first, and the ones under the line', () => {
    add(
      { title: 'clean' },
      { title: '320', codec: 'MP3', isLossless: false, sizeBytes: 8_000_000, durationMs: 200_000 },
      { title: '128', codec: 'MP3', isLossless: false, sizeBytes: 3_200_000, durationMs: 200_000 },
    );
    expect(titlesOf('lossy')).toEqual(['128', '320']);
    expect(titlesOf('lossy-low-bitrate')).toEqual(['128']);
  });

  it('counts hi-res by rate or depth, for information', () => {
    add(
      { title: 'cd' },
      { title: '96', sampleRate: 96_000 },
      { title: '24', bitDepth: 24 },
      { title: '48', sampleRate: 48_000 },
    );
    expect(titlesOf('hi-res')).toEqual(['96', '24']);
    const hiRes = buildReport(queries.stored(), { fileFacts: false, artSizes: false })
      .groups.flatMap(({ checks }) => checks)
      .find(({ id }) => id === 'hi-res');
    expect(hiRes?.isInfo).toBe(true);
  });

  it('tells a FLAC with no MD5 from one with, and leaves MP3s out', () => {
    add(
      { title: 'set', hash: 'flac-md5:abc' },
      { title: 'unset', hash: 'frames:abc' },
      { title: 'mp3', codec: 'MP3', isLossless: false, hash: 'frames:def' },
    );
    expect(titlesOf('flac-md5-unset')).toEqual(['unset']);
  });

  it('only counts covers once they are measured, smallest side first, and leaves out what could not be', () => {
    add(
      { title: 'none', art: null },
      { title: 'huge', art: 'huge' },
      { title: 'middling', art: 'middling' },
      { title: 'tiny', art: 'tiny' },
      { title: 'wide', art: 'wide' },
      { title: 'broken', art: 'broken' },
      { title: 'unmeasured', art: 'unmeasured' },
    );
    createLibraryWrites(db).setArtSizes([
      { hash: 'huge', width: 1400, height: 1400 },
      { hash: 'middling', width: 800, height: 800 },
      { hash: 'tiny', width: 200, height: 200 },
      { hash: 'wide', width: 1600, height: 300 },
      { hash: 'broken', width: 0, height: 0 },
    ]);
    expect(titlesOf('no-cover')).toEqual(['none']);
    expect(titlesOf('cover-low-res')).toEqual(['tiny', 'wide']);
    expect(titlesOf('cover-small')).toEqual(['tiny', 'wide', 'middling']);
    expect(queries.stored().unmeasuredArt).toBe(1);
  });

  it('finds repeated track numbers only with no disc number to tell them apart', () => {
    add(
      { title: 'a1', album: 'Repeats', trackNumber: 1 },
      { title: 'a2', album: 'Repeats', trackNumber: 1 },
      { title: 'a3', album: 'Repeats', trackNumber: 2 },
      { title: 'b1', album: 'Discs', trackNumber: 1, discNumber: 1 },
      { title: 'b2', album: 'Discs', trackNumber: 1, discNumber: 2 },
      { title: 'c1', album: 'One', trackNumber: 1 },
    );
    expect(titlesOf('repeated-track-numbers').toSorted()).toEqual(['a1', 'a2']);
  });

  it('covers the plain tags', () => {
    add(
      { title: 'fine' },
      { title: 'no year', year: null },
      { title: 'no genre', genres: [] },
      { title: 'no number', trackNumber: null },
      { title: 'no album', album: null, trackNumber: null },
      { title: 'no album artist', facts: { hasAlbumArtist: false } },
      { title: 'no gain', facts: { hasReplayGain: false } },
    );
    expect(titlesOf('no-year')).toEqual(['no year']);
    expect(titlesOf('no-genre')).toEqual(['no genre']);
    expect(titlesOf('no-track-number')).toEqual(['no number']);
    expect(titlesOf('no-album')).toEqual(['no album']);
    expect(titlesOf('no-album-artist')).toEqual(['no album artist']);
    expect(titlesOf('no-replaygain')).toEqual(['no gain']);
  });

  it('keeps scan issues apart: a file name for a title is one check, the rest another', () => {
    add({ title: 'named', path: 'named.flac' }, { title: 'other', path: 'other.flac' });
    const issue = db.prepare('INSERT INTO scan_issues (rel_path, kind, message) VALUES (?, ?, ?)');
    issue.run('named.flac', 'bad_tags', 'No title tag');
    issue.run('broken.flac', 'unreadable', 'Nope');
    issue.run('album.cue', 'bad_cue', 'Nope');
    expect(titlesOf('title-is-file-name')).toEqual(['named']);
    expect(count('scan-issues')).toBe(2);
  });

  it('finds missing files on their own, and duplicates by audio with the copies side by side', () => {
    add(
      { title: 'first', hash: 'same', path: 'a.flac' },
      { title: 'alone', hash: 'other', path: 'b.flac' },
      { title: 'second', hash: 'same', path: 'c.flac' },
      { title: 'gone', hash: 'gone', path: 'd.flac' },
      { title: 'also gone', hash: 'same', path: 'e.flac' },
    );
    db.prepare(`UPDATE files SET missing_since = 1 WHERE rel_path IN ('d.flac', 'e.flac')`).run();
    expect(titlesOf('missing').toSorted()).toEqual(['also gone', 'gone']);
    expect(titlesOf('duplicates')).toEqual(['first', 'second']);
    expect(queries.stored().summary.tracks).toBe(3);
  });

  it('sorts the lyrics states out', () => {
    add(
      { title: 'unasked' },
      { title: 'none' },
      { title: 'synced' },
      { title: 'plain' },
      { title: 'quiet' },
      {
        title: 'nobody',
        artist: 'Unknown Artist',
      },
    );
    const store = db.prepare(
      `INSERT INTO lyrics (track_id, status, synced_lrc, plain_text, fetched_at)
       SELECT id, ?, ?, ?, 1 FROM tracks WHERE title = ?`,
    );
    store.run('not_found', null, null, 'none');
    store.run('found', '[00:01.00]x', 'x', 'synced');
    store.run('found', null, 'x', 'plain');
    store.run('instrumental', null, null, 'quiet');
    expect(titlesOf('no-lyrics').toSorted()).toEqual(['nobody', 'none', 'unasked']);
    expect(titlesOf('lyrics-not-asked')).toEqual(['unasked']);
    expect(titlesOf('lyrics-plain')).toEqual(['plain']);
    expect(titlesOf('lyrics-instrumental')).toEqual(['quiet']);
  });

  it('reads the fingerprint and listener rows the way those features wrote them', () => {
    add(
      { title: 'done', artist: 'The Band', hash: 'one' },
      { title: 'Not Done (Remastered 2011)', artist: 'The Band', hash: 'two' },
      { title: 'other artist', artist: 'Stranger', hash: 'three' },
      { title: 'nobody', artist: 'Unknown Artist', hash: 'four' },
    );
    const print = db.prepare(
      'INSERT INTO fingerprints (audio_hash, start_ms, end_ms, model, vector, created_at) VALUES (?, 0, -1, ?, ?, 1)',
    );
    print.run('one', FINGERPRINT_MODEL, Buffer.alloc(4));
    print.run('two', 'an old model', Buffer.alloc(4));
    expect(titlesOf('no-fingerprint').toSorted()).toEqual(['Not Done (Remastered 2011)', 'nobody', 'other artist']);

    const ask = db.prepare(
      `INSERT INTO listener_lookups (source, kind, artist_key, title_key, found, fetched_at)
       VALUES ('listenbrainz', ?, ?, ?, 1, 1)`,
    );
    ask.run('artist', artistKey('The Band'), '');
    ask.run('track', artistKey('The Band'), titleKey('done'));
    ask.run('track', artistKey('Stranger'), titleKey('other artist'));
    expect(titlesOf('not-looked-up').toSorted()).toEqual(['Not Done (Remastered 2011)', 'other artist']);
  });

  it("doesn't call a check clear while what it needs is still being read", () => {
    add({ title: 'one' });
    const stored = queries.stored();
    const check = (fileFacts: boolean, artSizes: boolean) =>
      buildReport(stored, { fileFacts, artSizes })
        .groups.flatMap(({ checks }) => checks)
        .filter(({ isChecking }) => isChecking)
        .map(({ id }) => id);
    expect(check(false, false)).toEqual([]);
    expect(check(true, false)).toEqual(['no-replaygain', 'no-album-artist', 'no-gapless-header']);
    expect(check(false, true)).toEqual(['cover-low-res', 'cover-small']);
  });
});

describe('reading what was never kept', () => {
  it('fills the rows in from real files, leaves the files alone, and says what it could not read', async () => {
    const root = tempDir('report-files');
    const withHeader = join(root, 'with.mp3');
    const without = join(root, 'without.mp3');
    const flac = join(root, 'gain.flac');
    makeTone(withHeader, { frequency: 330, tags: { title: 'With', album_artist: 'Someone' } });
    ffmpeg(
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=0.4',
      '-write_xing',
      '0',
      '-id3v2_version',
      '3',
      '-metadata',
      'title=Without',
      without,
    );
    makeTone(flac, { frequency: 550, tags: { title: 'Gain', REPLAYGAIN_TRACK_GAIN: '-6.00 dB' } });
    copyFileSync(flac, join(root, 'plain.flac'));
    retag(join(root, 'plain.flac'), { title: 'Plain' });

    add(
      { title: 'With', path: 'with.mp3' },
      { title: 'Without', path: 'without.mp3' },
      { title: 'Gain', path: 'gain.flac' },
      { title: 'Plain', path: 'plain.flac' },
      { title: 'Gone', path: 'gone.flac' },
    );
    db.prepare('UPDATE files SET has_replaygain = NULL, has_album_artist = NULL, has_gapless_header = NULL').run();
    expect(queries.stored().unreadFiles).toBe(5);

    expect(await fillFileFacts(db, root)).toBe(1);
    expect(queries.stored().unreadFiles).toBe(1);

    expect(titlesOf('no-gapless-header')).toEqual(['Without']);
    expect(titlesOf('no-replaygain').toSorted()).toEqual(['Plain', 'With', 'Without']);
    expect(titlesOf('no-album-artist')).not.toContain('With');
    expect((await readFileFacts(flac)).hasReplayGain).toBe(true);
    expect((await readFileFacts(flac)).hasGaplessHeader).toBeNull();
  });
});
