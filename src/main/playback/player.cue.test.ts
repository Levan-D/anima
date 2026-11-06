/*
 * CUE tracks on real mpv and a real database, with the rows put in by hand until the parser arrives in Phase 6.
 * Byte checks go through the PCM writer, and the rest is --ao=null in real time. Silent.
 */

import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createArtCache } from '@main/library/artCache';
import { createLibrary, type Library } from '@main/library/library';
import { artInProcess, FFMPEG, ffmpeg, maintenanceInProcess, scanInProcess, tempDir } from '@main/library/testFixtures';
import {
  decodeAlone,
  finishedWriting,
  firstDifference,
  HAS_MPV,
  makeStereoTone,
  pcmArgs,
  startRealPlayerOn,
  type RealPlayer,
} from './testAudio';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

const SILENT_LOG = { info: () => {}, warn: () => {}, error: () => {} };
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

type Ranges = [startMs: number, endMs: number | null][];

/** Turns the one track a scan made for a file into a track per range, as a CUE sheet would. */
function splitIntoRanges(library: Library, relPath: string, ranges: Ranges): number[] {
  const session = library.perConnection((db) => db);
  const result = session((db) => {
    const file = db.prepare('SELECT id FROM files WHERE rel_path = ?').get(relPath) as { id: number };
    const first = db.prepare('SELECT id, artist_id AS artistId FROM tracks WHERE file_id = ?').get(file.id) as {
      id: number;
      artistId: number;
    };
    db.prepare('UPDATE tracks SET cue_index = 1, start_ms = ?, end_ms = ? WHERE id = ?').run(
      ranges[0]?.[0],
      ranges[0]?.[1],
      first.id,
    );
    const ids = [first.id];
    ranges.slice(1).forEach(([startMs, endMs], index) => {
      const inserted = db
        .prepare(
          `INSERT INTO tracks (file_id, cue_index, start_ms, end_ms, title, sort_title, artist_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(file.id, index + 2, startMs, endMs, `Part ${index + 2}`, `part ${index + 2}`, first.artistId);
      ids.push(Number(inserted.lastInsertRowid));
    });
    return ids;
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe.skipIf(!HAS_MPV)('CUE tracks through the Player', () => {
  let folder: string;
  let library: Library;
  let album: number[];
  let short: number[];
  let other: number;
  let running: RealPlayer | null = null;

  const albumPath = () => join(folder, 'album.flac');
  const otherPath = () => join(folder, 'other.flac');

  beforeAll(async () => {
    folder = tempDir('cue-library');
    // Three tones end to end, so a mistake at a boundary shows, as the one file a CUE album is.
    const parts = tempDir('cue-parts');
    const list = [220, 330, 440].map((frequency, index) => {
      const path = join(parts, `${index}.flac`);
      makeStereoTone(path, { frequency, seconds: 30 });
      return path;
    });
    ffmpeg(
      ...list.flatMap((path) => ['-i', path]),
      '-filter_complex',
      'concat=n=3:v=0:a=1',
      '-sample_fmt',
      's16',
      albumPath(),
    );
    makeStereoTone(otherPath(), { frequency: 550, seconds: 30 });
    makeStereoTone(join(folder, 'short.flac'), { frequency: 660, seconds: 4 });

    const art = artInProcess();
    let libraryFolder = folder;
    library = createLibrary({
      settings: {
        get: () => ({ libraryFolder }),
        update: (patch) => {
          libraryFolder = patch.libraryFolder;
        },
      },
      emit: () => {},
      notify: () => {},
      log: SILENT_LOG,
      pickFolder: () => Promise.resolve(null),
      devDataRoot: tempDir('cue-data'),
      hostname: 'here',
      now: Date.now,
      art: createArtCache({ cacheDir: tempDir('cue-cache'), ffmpegPath: FFMPEG, start: art.start, log: SILENT_LOG }),
      runScan: scanInProcess(),
      runMaintenance: maintenanceInProcess(),
      findBackup: () => Promise.resolve(null),
      artPassDelayMs: 60_000,
    });
    library.open();
    await vi.waitFor(() => expect(library.scanState().phase).toBe('idle'), { timeout: 60_000, interval: 20 });

    album = splitIntoRanges(library, 'album.flac', [
      [0, 30_000],
      [30_000, 60_000],
      [60_000, null],
    ]);
    short = splitIntoRanges(library, 'short.flac', [
      [0, 1200],
      [1200, 2400],
      [2400, null],
    ]);
    const others = library.read((queries) => queries.tracks({ kind: 'all' }));
    const found = others.ok ? others.value.find(({ relPath }) => relPath === 'other.flac') : undefined;
    other = found?.id ?? -1;
  });

  afterEach(() => {
    running?.stop();
    running = null;
  });

  const start = (args: string[]) => {
    running = startRealPlayerOn(library, args, { replayGainMode: 'off' });
    return running;
  };

  it('finds the ranges through the library', () => {
    const playable = library.playableTracks(album);
    expect(playable.ok && playable.value.map(({ range }) => [range.startMs, range.endMs])).toEqual([
      [0, 30_000],
      [30_000, 60_000],
      [60_000, null],
    ]);
    expect(playable.ok && playable.value.map(({ track }) => track.durationMs)).toEqual([30_000, 30_000, 30_000]);
  });

  it('plays a contiguous album as one load, identical to the file, then gapless into the next file', async () => {
    const file = join(tempDir('cue-out'), 'album.pcm');
    const { player, until, sent, notices } = start(pcmArgs(file, 's32'));
    player.play([...album, other], 0);
    const ended = await until(({ status }) => status === 'ended', 'the end of the queue');
    expect(ended.queueIndex).toBe(3);
    expect(notices).toEqual([]);

    const output = await finishedWriting(file);
    const expected = Buffer.concat([decodeAlone(albumPath(), 's32'), decodeAlone(otherPath(), 's32')]);
    expect(firstDifference(output, expected)).toBeNull();

    const loads = sent().filter(([name]) => name === 'loadfile');
    expect(loads.map(([, path, mode]) => [path, mode])).toEqual([
      [albumPath(), 'replace'],
      [otherPath(), 'append'],
    ]);
  });

  it('stops a range at its end when what follows is not contiguous: identical to those ranges alone', async () => {
    const file = join(tempDir('cue-out'), 'ranges.pcm');
    const [first, , third] = album as [number, number, number];
    const { player, until, sent } = start(pcmArgs(file, 's32'));
    player.play([first, other, third], 0);
    await until(({ status }) => status === 'ended', 'the end of the queue');

    const output = await finishedWriting(file);
    const expected = Buffer.concat([
      decodeAlone(albumPath(), 's32', ['--end=30.000']),
      decodeAlone(otherPath(), 's32'),
      decodeAlone(albumPath(), 's32', ['--start=60.000']),
    ]);
    expect(firstDifference(output, expected)).toBeNull();

    const loads = sent().filter(([name]) => name === 'loadfile');
    expect(loads.map(([, , , , options]) => options)).toEqual(['end=30.000', undefined, 'start=60.000']);
  });

  it('crosses boundaries in real time: the queue moves, nothing loads, and the position is the track’s', async () => {
    const { player, until, sent, states } = start(['--ao=null']);
    player.play(short, 0);
    const first = await until(({ status }) => status === 'playing', 'playing');
    expect(first.current?.id).toBe(short[0]);
    expect(first.durationMs).toBe(1200);

    const second = await until(({ queueIndex }) => queueIndex === 1, 'the second track', 5000);
    expect(second.loadId).toBeGreaterThan(first.loadId);
    expect(second.status).toBe('playing');
    expect(second.current?.id).toBe(short[1]);
    expect(player.position().positionMs).toBeLessThan(400);

    const third = await until(({ queueIndex }) => queueIndex === 2, 'the third track', 5000);
    expect(third.loadId).toBeGreaterThan(second.loadId);

    expect(sent().filter(([name]) => name === 'loadfile')).toHaveLength(1);
    expect(states.map(({ status }) => status).slice(1)).not.toContain('loading');

    await until(({ status }) => status === 'ended', 'the end', 10_000);
    expect(player.state().current?.id).toBe(short[2]);
  });

  it('goes back within the file with a seek', async () => {
    const { player, until, sent } = start(['--ao=null']);
    player.play(album, 0);
    await until(({ status }) => status === 'playing', 'playing');
    player.next();
    await until(({ queueIndex, status }) => queueIndex === 1 && status === 'playing', 'the second track');
    await wait(200);
    expect(player.position().positionMs).toBeGreaterThan(0);
    expect(player.position().positionMs).toBeLessThan(2000);

    player.previous();
    await until(({ queueIndex, status }) => queueIndex === 0 && status === 'playing', 'the first track again');
    await wait(300);
    expect(player.state().queueIndex).toBe(0);
    expect(player.position().positionMs).toBeLessThan(2000);

    expect(sent().filter(([name]) => name === 'loadfile')).toHaveLength(1);
    expect(
      sent()
        .filter(([name]) => name === 'seek')
        .map(([, seconds]) => seconds),
    ).toEqual([30, 0]);
  });

  it('moves where the file stops when what follows changes, and mpv really stops there', async () => {
    const { player, until, sent } = start(['--ao=null']);
    player.play(short, 0);
    await until(({ status }) => status === 'playing', 'playing');

    const [, second] = player.queue();
    player.removeFromQueue([second?.queueId ?? -1]);
    await vi.waitFor(() => {
      expect(sent()).toContainEqual(['set_property', 'file-local-options/end', '1.200']);
    });

    // It goes from the end of the first range to the third, skipping what's in between.
    const third = await until(({ queueIndex }) => queueIndex === 1, 'the next range', 5000);
    expect(third.current?.id).toBe(short[2]);
    await until(({ status }) => status === 'playing', 'playing it');
    await wait(300);
    expect(player.position().positionMs).toBeLessThan(1000);
    await until(({ status }) => status === 'ended', 'the end', 10_000);
  });

  it('restores the right track and place after a crash in the middle of an album', async () => {
    const { player, until, spawned } = start(['--ao=null']);
    player.play(album, 1);
    await until(({ status }) => status === 'playing', 'playing');
    await wait(600);
    const before = player.position().positionMs;
    const loadId = player.state().loadId;

    spawned[0]?.kill();
    await until((state) => state.status === 'playing' && state.loadId > loadId, 'the restart', 15_000);
    await wait(300);
    expect(player.state().current?.id).toBe(album[1]);
    expect(player.position().positionMs).toBeGreaterThanOrEqual(before - 100);
    expect(player.position().positionMs).toBeLessThan(before + 2000);
  });
});
