/*
 * The two files the spike used, from the real library, through the whole Player. Read-only on the folder, and silent:
 * the output is mpv's PCM writer, into .dev. Skipped unless MUSIC_PLAYER_REAL_LIBRARY names the folder:
 *
 *   MUSIC_PLAYER_REAL_LIBRARY='D:\Music' npx vitest run src/main/playback/player.realFiles.test.ts
 */

import { existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { serialize } from 'node:v8';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ok } from '@shared/result';
import { connect } from '@main/db/connection';
import { libraryPaths } from '@main/library/dataDir';
import { createQueries } from '@main/library/queries';
import { tempDir } from '@main/library/testFixtures';
import {
  decibels,
  decodeAlone,
  fileTrack,
  finishedWriting,
  firstDifference,
  floatsOf,
  HAS_MPV,
  pcmArgs,
  rms,
  startRealPlayer,
  type RealPlayer,
} from './testAudio';
import { makeHarness } from './testFixtures';

vi.setConfig({ testTimeout: 300_000 });

const FOLDER = process.env.MUSIC_PLAYER_REAL_LIBRARY;
const ALBUM = ['Nightwish', 'Human II Nature', 'Human'];
const FRAME_BYTES = 8;
const TAGGED_GAIN_DB = -6.21;

/** A copy of the real database, which playerRealLibrary.spec.ts makes. */
const REAL_DATABASE = libraryPaths(FOLDER ?? '', join('.dev', 'real', 'player', 'data')).dbPath;

describe.skipIf(!FOLDER || !existsSync(REAL_DATABASE))('what a queue of everything costs on main', () => {
  it('stays well under a frame for anything but filling it, and not much more for that', async () => {
    const db = connect(REAL_DATABASE);
    const queries = createQueries(db);
    const ids = queries.tracks({ kind: 'all' }).map(({ id }) => id);
    const harness = makeHarness({
      deps: {
        library: {
          status: () => ({
            state: 'ready',
            folder: 'D:\\Music',
            isEmpty: false,
            lastChanged: null,
            changedElsewhere: false,
          }),
          onStatus: () => () => {},
          playableTracks: (trackIds) => ok(queries.playableTracks(trackIds)),
          absolutePath: (trackId) => queries.relPathOfTrack(trackId),
          markMissingIfGone: () => Promise.resolve(false),
        },
      },
    });
    harness.player.start();
    await harness.settle();
    const { player } = harness;

    const timed = (work: () => unknown, times = 50) => {
      const samples: number[] = [];
      for (let run = 0; run < times; run++) {
        const at = performance.now();
        work();
        samples.push(performance.now() - at);
      }
      const sorted = samples.toSorted((a, b) => a - b);
      return { median: Number(sorted[Math.floor(times / 2)]?.toFixed(2)), worst: Number(sorted.at(-1)?.toFixed(2)) };
    };

    const cost: Record<string, { median: number; worst: number }> = {
      readTracksFromTheDatabase: timed(() => queries.playableTracks(ids), 20),
      replaceTheQueue: timed(() => player.play(ids, 0), 20),
      fetchTheQueue: timed(() => player.queue(), 20),
      // What IPC does with the answer on this side, which is the same kind of serializer.
      serializeTheQueue: timed(() => serialize(player.queue()), 10),
    };
    console.log(`The queue serializes to ${serialize(player.queue()).length} bytes`);
    await harness.settle();
    const everyId = player.queue().map(({ queueId }) => queueId);
    cost.moveOne = timed(() => player.moveInQueue([everyId[3000] as number], 1));
    cost.enqueueAnAlbumNext = timed(() => player.enqueue(ids.slice(0, 12), 'next'), 20);
    cost.enqueueEverything = timed(() => player.enqueue(ids, 'after-added'), 3);
    cost.removeOne = timed(() => player.removeFromQueue([(everyId[4000] as number) + 1]), 1);
    cost.removeAThousand = timed(() => player.removeFromQueue(everyId.slice(100, 1100)), 1);
    cost.next = timed(() => player.next(), 20);
    cost.previous = timed(() => player.previous(), 20);
    cost.positionTick = timed(() => harness.mpv().timePos(1), 200);
    cost.clear = timed(() => player.clearQueue(), 1);
    console.log(JSON.stringify(cost, null, 2));

    player.quit();
    db.close();
    expect(ids.length).toBe(5719);
    for (const [name, { worst }] of Object.entries(cost)) {
      if (!['readTracksFromTheDatabase', 'replaceTheQueue', 'enqueueEverything'].includes(name)) {
        expect(worst, name).toBeLessThan(16);
      }
    }
  });
});

describe.skipIf(!FOLDER || !HAS_MPV)('the real files', () => {
  const folder = FOLDER ?? '';
  const music = join(folder, ...ALBUM, 'Music.flac');
  const noise = join(folder, ...ALBUM, 'Noise.flac');
  let running: RealPlayer | null = null;

  afterEach(() => {
    running?.stop();
    running = null;
  });

  it('plays Music into Noise byte-identically, across the boundary', async () => {
    const dir = tempDir('real-gapless');
    const file = join(dir, 'chain.pcm');
    const tracks = [fileTrack(1, music), fileTrack(2, noise)];
    const before = [statSync(music).mtimeMs, statSync(noise).mtimeMs];

    running = startRealPlayer(tracks, pcmArgs(file, 's32'), { replayGainMode: 'off' });
    running.player.play([1, 2], 0);
    await running.until(({ status }) => status === 'ended', 'the end of the queue', 240_000);
    expect(running.notices).toEqual([]);

    const output = await finishedWriting(file);
    const alone = [decodeAlone(music, 's32'), decodeAlone(noise, 's32')];
    const [musicAlone, noiseAlone] = alone as [Buffer, Buffer];
    expect(firstDifference(output, Buffer.concat(alone))).toBeNull();

    // Right at the seam, for the record.
    const seam = musicAlone.length;
    expect(output.subarray(seam - FRAME_BYTES, seam).equals(musicAlone.subarray(-FRAME_BYTES))).toBe(true);
    expect(output.subarray(seam, seam + FRAME_BYTES).equals(noiseAlone.subarray(0, FRAME_BYTES))).toBe(true);
    console.log(
      `Music ${musicAlone.length / FRAME_BYTES} frames, Noise ${noiseAlone.length / FRAME_BYTES} frames, ` +
        `${output.length / FRAME_BYTES} frames through the Player, identical`,
    );

    rmSync(dir, { recursive: true, force: true });
    expect([statSync(music).mtimeMs, statSync(noise).mtimeMs]).toEqual(before);
  });

  it('moves Music by its ReplayGain tag, in both modes', async () => {
    const dir = tempDir('real-gain');
    // Five seconds from the middle, as a range, the way the spike measured it.
    const range = { startMs: 60_000, endMs: 65_000 };
    const tracks = [fileTrack(1, music, range, 5000)];

    const render = async (mode: 'off' | 'track' | 'album') => {
      const file = join(dir, `${mode}.pcm`);
      const { player, until, stop } = startRealPlayer(tracks, pcmArgs(file, 'float'), { replayGainMode: mode });
      try {
        player.play([1], 0);
        await until(({ status }) => status === 'ended', 'the end of the queue', 60_000);
        return floatsOf(await finishedWriting(file));
      } finally {
        stop();
      }
    };

    const off = rms(await render('off'));
    const album = decibels(rms(await render('album')), off);
    const track = decibels(rms(await render('track')), off);
    console.log(`Music.flac: album ${album.toFixed(3)} dB, track ${track.toFixed(3)} dB, tagged ${TAGGED_GAIN_DB} dB`);
    expect(Math.abs(album - TAGGED_GAIN_DB)).toBeLessThan(0.01);
    expect(Math.abs(track - TAGGED_GAIN_DB)).toBeLessThan(0.01);
  });
});
