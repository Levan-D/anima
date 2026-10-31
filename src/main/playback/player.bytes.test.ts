/*
 * Byte-level checks through the whole Player, the method from the spike: mpv's PCM writer runs as fast as it can, and
 * what it wrote gets compared with what each file decodes to alone. No device is involved.
 */

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { tempDir } from '@main/library/testFixtures';
import {
  decibels,
  decodeAlone,
  fileTrack,
  finishedWriting,
  firstDifference,
  floatsOf,
  HAS_MPV,
  makeStereoTone,
  pcmArgs,
  rms,
  startRealPlayer,
  type FileTrack,
  type RealPlayer,
} from './testAudio';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

const GAIN_TOLERANCE_DB = 0.02;
const STRETCH_BYTES = 5 * 44_100 * 2 * 4;
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

describe.skipIf(!HAS_MPV)('bytes through the Player', () => {
  let dir: string;
  let gapless: FileTrack[];
  let running: RealPlayer | null = null;

  const start = (...args: Parameters<typeof startRealPlayer>) => {
    running = startRealPlayer(...args);
    return running;
  };

  beforeAll(() => {
    dir = tempDir('player-bytes');
    // Long enough that the top-up after a transition is in well before the writer gets through the file.
    gapless = [440, 660, 880].map((frequency, index) => {
      const path = join(dir, `gapless-${index + 1}.flac`);
      makeStereoTone(path, { frequency, seconds: 60 });
      return fileTrack(index + 1, path, {}, 60_000);
    });
  });

  afterEach(() => {
    running?.stop();
    running = null;
  });

  it('plays gaplessly across the queue’s boundaries: identical to the tracks decoded alone', async () => {
    const file = join(dir, 'gapless.pcm');
    const { player, until, sent, notices } = start(gapless, pcmArgs(file, 's32'), {
      replayGainMode: 'off',
    });
    player.play([1, 2, 3], 0);
    const ended = await until(({ status }) => status === 'ended', 'the end of the queue');
    expect(ended.queueIndex).toBe(2);
    expect(notices).toEqual([]);

    const output = await finishedWriting(file);
    const expected = Buffer.concat(gapless.map(({ path }) => decodeAlone(path, 's32')));
    expect(firstDifference(output, expected)).toBeNull();
    expect(output.length).toBe(60 * 3 * 44_100 * 2 * 4);

    // It got there through the window: two loads up front, and each transition topped up by one.
    const loads = sent().filter(([name]) => name === 'loadfile');
    expect(loads.map(([, , mode]) => mode)).toEqual(['replace', 'append', 'append']);
    expect(sent().filter(([name]) => name === 'playlist-remove')).toHaveLength(2);
  });

  it('fails that comparison with gapless off, so it can tell', async () => {
    const file = join(dir, 'not-gapless.pcm');
    const { player, until } = start(gapless, pcmArgs(file, 's32', ['--gapless-audio=no']), { replayGainMode: 'off' });
    player.play([1, 2], 0);
    await until(({ status }) => status === 'ended', 'the end of the queue');
    const output = await finishedWriting(file);
    const expected = Buffer.concat(gapless.slice(0, 2).map(({ path }) => decodeAlone(path, 's32')));
    expect(firstDifference(output, expected)).not.toBeNull();
  });

  it('leaves the audio untouched at volume 100', async () => {
    const file = join(dir, 'volume-100.pcm');
    const { player, until } = start(gapless, pcmArgs(file, 's32'), { replayGainMode: 'off', volume: 100 });
    player.play([1], 0);
    await until(({ status }) => status === 'ended', 'the end of the queue');
    expect(firstDifference(await finishedWriting(file), decodeAlone(gapless[0]?.path ?? '', 's32'))).toBeNull();
  });

  describe('ReplayGain', () => {
    let both: FileTrack;
    let trackOnly: FileTrack;
    let none: FileTrack;
    let overFullScale: FileTrack;
    let references: Map<number, number>;

    beforeAll(() => {
      const make = (id: number, tags: Record<string, string>) => {
        const path = join(dir, `gain-${id}.flac`);
        makeStereoTone(path, { frequency: 440, seconds: 20, tags });
        return fileTrack(id, path, {}, 20_000);
      };
      both = make(11, { REPLAYGAIN_TRACK_GAIN: '-6.00 dB', REPLAYGAIN_ALBUM_GAIN: '-9.00 dB' });
      trackOnly = make(12, { REPLAYGAIN_TRACK_GAIN: '-3.00 dB' });
      none = make(13, {});
      overFullScale = make(14, { REPLAYGAIN_TRACK_GAIN: '+6.00 dB', REPLAYGAIN_TRACK_PEAK: '1.000000' });
      references = new Map(
        [both, trackOnly, none, overFullScale].map(({ track, path }) => [
          track.id,
          rms(floatsOf(decodeAlone(path, 'float'))),
        ]),
      );
    });

    const allTracks = () => [both, trackOnly, none, overFullScale];

    /** Plays one file in one mode, with the mode set after mpv is up, and measures it against the same file with none. */
    async function measure(item: FileTrack, mode: 'off' | 'track' | 'album'): Promise<number> {
      const file = join(dir, `gain-${item.track.id}-${mode}.pcm`);
      const { player, until, stop } = startRealPlayer(allTracks(), pcmArgs(file, 'float'), { replayGainMode: 'off' });
      running = null;
      try {
        await wait(50);
        player.setReplayGainMode(mode);
        player.play([item.track.id], 0);
        await until(({ status }) => status === 'ended', 'the end of the queue');
        return decibels(rms(floatsOf(await finishedWriting(file))), references.get(item.track.id) ?? 1);
      } finally {
        stop();
      }
    }

    it.each([
      ['both tags', () => both, { off: 0, track: -6, album: -9 }],
      ['only a track tag, which album falls back to', () => trackOnly, { off: 0, track: -3, album: -3 }],
      ['no tags', () => none, { off: 0, track: 0, album: 0 }],
      ['a gain its peak has no room for, which comes down to fit', () => overFullScale, { off: 0, track: 0, album: 0 }],
    ])('measures right for a file with %s', async (_name, item, expected) => {
      for (const mode of ['off', 'track', 'album'] as const) {
        expect(Math.abs((await measure(item(), mode)) - expected[mode])).toBeLessThan(GAIN_TOLERANCE_DB);
      }
    });

    it('moves the level when the mode changes in the middle of a file', async () => {
      const path = join(dir, 'gain-long.flac');
      makeStereoTone(path, {
        frequency: 440,
        seconds: 500,
        tags: { REPLAYGAIN_TRACK_GAIN: '-6.00 dB', REPLAYGAIN_ALBUM_GAIN: '-12.00 dB' },
      });
      const file = join(dir, 'gain-long.pcm');
      const { player, until, stop } = startRealPlayer([fileTrack(20, path, {}, 500_000)], pcmArgs(file, 'float'), {
        replayGainMode: 'off',
      });
      running = null;
      const size = () => statSync(file, { throwIfNoEntry: false })?.size ?? 0;
      const sizeOnceSettled = async () => {
        let last = -1;
        for (let same = 0; same < 3;) {
          await wait(25);
          const now = size();
          same = now === last ? same + 1 : 0;
          last = now;
        }
        return last;
      };

      try {
        // Paused before it can write anything, then let out a little at a time, since the writer goes so fast.
        await wait(50);
        player.play([20], 0);
        player.pause();
        await until(({ status }) => status === 'paused', 'the file to load');

        const stretches: { mode: 'off' | 'track' | 'album'; from: number; to: number }[] = [];
        for (const mode of ['off', 'track', 'album', 'off', 'album'] as const) {
          // From the top each time, so however far a stretch runs before it's stopped, the file doesn't run out.
          player.seek(0);
          player.setReplayGainMode(mode);
          const from = await sizeOnceSettled();
          player.resume();
          while (size() < from + STRETCH_BYTES) await new Promise((done) => setImmediate(done));
          player.pause();
          stretches.push({ mode, from, to: await sizeOnceSettled() });
        }

        const samples = floatsOf(readFileSync(file));
        const level = ({ from, to }: { from: number; to: number }) => {
          const start = Math.floor(from / 4);
          const end = Math.floor(to / 4);
          // The change lands at the next block handed over, so only the middle of each stretch counts.
          return rms(samples.subarray(start + Math.floor((end - start) * 0.3), end - Math.floor((end - start) * 0.1)));
        };
        const reference = level(stretches[0] as (typeof stretches)[number]);
        const measured = stretches.map((stretch) => decibels(level(stretch), reference));
        const expected = [0, -6, -12, 0, -12];
        measured.forEach((value, index) => {
          expect(Math.abs(value - (expected[index] as number))).toBeLessThan(0.05);
        });
      } finally {
        stop();
      }
    });
  });
});
