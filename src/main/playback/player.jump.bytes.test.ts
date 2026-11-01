/*
 * What a jump chosen by hand writes, through the whole Player. The PCM writer takes up to 1.5 s at a time, far coarser than
 * a device, so `arealtime` feeds it a few milliseconds at a time at the speed of playback, and each block carries the gain
 * of the moment it went out. mpv's core sleeps inside that filter for a whole decoded frame, and only hears commands between
 * them, so the files are written with short frames. No device is involved, so this says what mpv hands over and nothing
 * about what a device does.
 */

import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { EQ_AUTO_PREAMP, type EqSettings } from '@shared/domain';
import { ffmpeg, tempDir } from '@main/library/testFixtures';
import { chainFor, chainSpec } from './eqChain';
import { JUMP_FADE_TIMES } from './jumpFade';
import {
  decodeAlone,
  fileTrack,
  finishedWriting,
  firstDifference,
  floatsOf,
  HAS_MPV,
  makeStereoTone,
  pcmArgs,
  startRealPlayer,
  type FileTrack,
  type RealPlayer,
} from './testAudio';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

const AMPLITUDE = 0.25;
const SECONDS = 30;
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
const REALTIME = '--af=lavfi=[asetnsamples=n=64,arealtime]';

/** The first place they differ, in samples, or the length of the shorter. */
function samePrefix(actual: Float32Array, expected: Float32Array): number {
  const shared = Math.min(actual.length, expected.length);
  for (let at = 0; at < shared; at++) if (actual[at] !== expected[at]) return at;
  return shared;
}

type Jump = {
  cutAt: number;
  /** The gain each block of the old track went out at, as a share of the file, from the first one changed. */
  fall: number[];
  /** The biggest change in the old track's gain from one sample to the next. */
  biggestStep: number;
  peakAfterCut: number;
  /** Where in the output the new track holds exactly what it decodes to, and where in its file that is. */
  exactFrom: number;
  exactFromInFile: number;
};

/** Takes the output apart: the old file untouched, its fall, silence, the new file's rise, and the new file untouched. */
function readJump(output: Float32Array, from: Float32Array, to: Float32Array): Jump {
  const cutAt = samePrefix(output, from);

  const fall: number[] = [];
  let at = cutAt;
  let last = 1;
  let biggestStep = 0;
  for (; at < output.length; at += 2) {
    const original = from[at] ?? 0;
    const sample = output[at] ?? 0;
    if (Math.abs(original) < 0.02) continue;
    const gain = sample / original;
    if (gain < -0.01 || gain > last + 0.02) break;
    if (Math.abs(gain - last) > 0.005) {
      fall.push(gain);
      biggestStep = Math.max(biggestStep, last - gain);
      last = gain;
    }
    if (gain === 0) break;
  }

  // From the end, since the output finishes on the new track, wherever that is in its file.
  const probe = output.subarray(output.length - 2_000);
  let exactFromInFile = -1;
  for (let start = 0; start + probe.length <= to.length; start += 2) {
    if (to[start] === probe[0] && samePrefix(to.subarray(start, start + probe.length), probe) === probe.length) {
      exactFromInFile = start;
      break;
    }
  }
  let back = 0;
  while (
    exactFromInFile - back - 1 >= 0 &&
    output[output.length - 2_000 - back - 1] === to[exactFromInFile - back - 1]
  ) {
    back++;
  }

  let peakAfterCut = 0;
  for (let sample = cutAt; sample < output.length; sample++) {
    peakAfterCut = Math.max(peakAfterCut, Math.abs(output[sample] ?? 0));
  }
  return {
    cutAt,
    fall,
    biggestStep,
    peakAfterCut,
    exactFrom: output.length - 2_000 - back,
    exactFromInFile: exactFromInFile - back,
  };
}

describe.skipIf(!HAS_MPV)('a jump chosen by hand', () => {
  let dir: string;
  let tracks: FileTrack[];
  let running: RealPlayer | null = null;

  const start = (...args: Parameters<typeof startRealPlayer>) => {
    running = startRealPlayer(...args);
    return running;
  };
  const decoded = (id: number) => floatsOf(decodeAlone(tracks[id - 1]?.path ?? '', 'float'));
  const twoPicks = () => Promise.resolve({ trackIds: [2, 3], hasSignals: true });

  beforeAll(() => {
    dir = tempDir('player-jump');
    // Noise never lines up with itself, so where each part of the output came from has only one answer.
    tracks = [
      { rate: 44_100, name: 'one' },
      { rate: 44_100, name: 'two' },
      { rate: 48_000, name: 'three' },
    ].map(({ rate, name }, at) => {
      const path = join(dir, `${name}.flac`);
      ffmpeg(
        '-f',
        'lavfi',
        '-i',
        `anoisesrc=color=white:amplitude=${AMPLITUDE}:seed=${at + 1}:duration=${SECONDS}:sample_rate=${rate}`,
        '-ac',
        '2',
        '-sample_fmt',
        's16',
        '-frame_size',
        '256',
        path,
      );
      return fileTrack(at + 1, path, {}, SECONDS * 1000);
    });
  });

  afterEach(() => {
    running?.stop();
    running = null;
  });

  async function playThenJump(
    name: string,
    { radio, fade = JUMP_FADE_TIMES }: { radio: boolean; fade?: typeof JUMP_FADE_TIMES | null },
  ) {
    const file = join(dir, `${name}.pcm`);
    const started = start(
      tracks,
      pcmArgs(file, 'float', [REALTIME, '--ao-pcm-append=no']),
      { replayGainMode: 'off', outputMode: 'exclusive' },
      { suggest: twoPicks, jumpFade: fade },
    );
    const { player, until } = started;
    await wait(50);
    player.play(radio ? [1] : [1, 2, 3], 0);
    await until(({ status }) => status === 'playing', 'it to play');
    if (radio) {
      await player.radioPreview();
      player.playRadio(null);
    }
    await wait(2_000);
    player.next();
    await until(({ status, current }) => status === 'playing' && current?.id === 2, 'the next track');
    await wait(4_000);
    player.quit();
    return { ...started, output: floatsOf(await finishedWriting(file)) };
  }

  it.each([
    ['in a Library queue', false],
    ['in radio', true],
  ])('goes silent before the new track and comes back %s, with both otherwise untouched', async (_name, radio) => {
    const { output, notices } = await playThenJump(`fade-${String(radio)}`, { radio });
    const jump = readJump(output, decoded(1), decoded(2));

    console.log(JSON.stringify({ radio, fall: jump.fall, biggestStep: jump.biggestStep, peak: jump.peakAfterCut }));
    expect(notices).toEqual([]);
    expect(jump.cutAt).toBeGreaterThan(44_100);
    expect(Math.abs(jump.fall.at(-1) ?? 1)).toBe(0);
    expect(jump.peakAfterCut).toBeLessThanOrEqual(AMPLITUDE * 1.0001);
    // The rest of the new track is exactly what it decodes to.
    expect(output.length - jump.exactFrom).toBeGreaterThan(44_100);
  });

  // This writer wakes when it likes, sometimes for less than one block in the whole fall, where a device takes one every
  // few milliseconds. So the steps are only seen sometimes here. How many are sent is in player.jump.test.ts.
  it('lets a block taken during the fall through at a gain in between', { retry: 5 }, async () => {
    const { output } = await playThenJump('in-between', { radio: false });
    const { fall, biggestStep } = readJump(output, decoded(1), decoded(2));
    console.log(JSON.stringify({ fall, biggestStep }));
    expect(fall.length).toBeGreaterThan(1);
  });

  it('stops dead without it, so the measure can tell', async () => {
    const { output } = await playThenJump('no-fade', { radio: true, fade: null });
    const jump = readJump(output, decoded(1), decoded(2));
    // Straight from the old track to the new one, at full level and at the very start of the file.
    expect(jump.exactFromInFile).toBe(0);
    expect(jump.exactFrom).toBe(jump.cutAt);
  });

  it('leaves a track running into the next byte for byte, and never touches the volume', async () => {
    const file = join(dir, 'natural.pcm');
    const { player, until, sent } = start(
      tracks.slice(0, 2),
      pcmArgs(file, 's32'),
      { replayGainMode: 'off', outputMode: 'exclusive' },
      { jumpFade: JUMP_FADE_TIMES },
    );
    player.play([1, 2], 0);
    await until(({ status }) => status === 'ended', 'the end of the queue');
    const expected = Buffer.concat(tracks.slice(0, 2).map(({ path }) => decodeAlone(path, 's32')));
    expect(firstDifference(await finishedWriting(file), expected)).toBeNull();
    expect(sent().filter(([name, property]) => name === 'set_property' && property === 'volume')).toHaveLength(1);
  });

  it('loads only where a run of presses ends up, within the budget, and restores the volume exactly', async () => {
    const file = join(dir, 'rapid.pcm');
    const { player, until, sent, settings } = start(
      tracks,
      pcmArgs(file, 'float', [REALTIME]),
      { replayGainMode: 'off', volume: 80 },
      { jumpFade: JUMP_FADE_TIMES },
    );
    player.play([1, 2, 3], 0);
    await until(({ status }) => status === 'playing', 'it to play');
    await wait(500);

    const before = sent().length;
    player.next();
    player.next();
    const after = () => sent().slice(before);
    while (!after().some(([name]) => name === 'playlist-next' || name === 'loadfile')) await wait(1);
    await until(({ current, status }) => current?.id === 3 && status === 'playing', 'the last press');
    await wait(4_000);

    const moves = after().filter(
      ([name, , mode]) => name === 'playlist-next' || (name === 'loadfile' && mode === 'replace'),
    );
    expect(moves).toHaveLength(1);
    const volumes = after().filter(([name, property]) => name === 'set_property' && property === 'volume');
    expect(volumes.at(-1)?.[2]).toBe(settings.get().volume);
  });

  it('with the EQ on, nothing goes over the level and the new track is what the chain makes of it', async () => {
    const eq: EqSettings = {
      enabled: true,
      bands: [{ id: 1, kind: 'peak', frequencyHz: 1000, gainDb: -3, q: 1 }],
      preamp: EQ_AUTO_PREAMP,
    };
    const file = join(dir, 'eq.pcm');
    // Long, since nothing paces the writer once the chain has replaced the filters, and it mustn't finish inside the silence.
    const items = [
      { id: 1, seconds: 900, frequency: 440 },
      { id: 2, seconds: 600, frequency: 660 },
    ].map(({ id, seconds, frequency }) => {
      const path = join(dir, `eq-${id}.flac`);
      makeStereoTone(path, { frequency, seconds, volume: AMPLITUDE });
      return fileTrack(id, path, {}, seconds * 1000);
    });
    const { player, until, notices } = start(
      items,
      pcmArgs(file, 'float'),
      { replayGainMode: 'off', eq, outputMode: 'exclusive' },
      { jumpFade: JUMP_FADE_TIMES },
    );
    player.play([1, 2], 0);
    await until(({ status }) => status === 'playing', 'it to play');
    player.next();
    await until(({ status }) => status === 'ended', 'the end of the queue');

    const output = floatsOf(await finishedWriting(file));
    const filtered = floatsOf(decodeAlone(items[1]?.path ?? '', 'float', [`--af=${chainSpec(chainFor(eq))}`]));
    expect(notices).toEqual([]);
    expect(output.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0)).toBeLessThanOrEqual(AMPLITUDE);
    const tail = output.subarray(output.length - 44_100);
    expect(samePrefix(tail, filtered.subarray(filtered.length - 44_100))).toBe(44_100);
  });

  it('adds less than about 150 ms before the new track is heard', async () => {
    /** From the press to when the new track can be heard: with no fade the file being open, and with one the rise starting. */
    const measure = async (jumpFade: typeof JUMP_FADE_TIMES | null) => {
      const { player, until, sent, stop } = startRealPlayer(
        tracks.slice(0, 2),
        ['--ao=null'],
        { replayGainMode: 'off' },
        {
          jumpFade,
        },
      );
      try {
        player.play([1, 2], 0);
        await until(({ status }) => status === 'playing', 'it to play');
        await wait(600);
        const before = sent().length;
        const pressedAt = performance.now();
        player.next();
        await until(({ status, current }) => status === 'playing' && current?.id === 2, 'the next track');
        const isHeard = () => {
          const volumes = sent()
            .slice(before)
            .filter(([, property]) => property === 'volume')
            .map(([, , value]) => value as number);
          const silentAt = volumes.indexOf(0);
          return jumpFade === null || (silentAt >= 0 && volumes.slice(silentAt + 1).some((value) => value > 0));
        };
        while (!isHeard()) await wait(1);
        return performance.now() - pressedAt;
      } finally {
        stop();
      }
    };
    const median = async (jumpFade: typeof JUMP_FADE_TIMES | null) => {
      const runs: number[] = [];
      for (let run = 0; run < 5; run++) runs.push(await measure(jumpFade));
      return runs.sort((a, b) => a - b)[2] as number;
    };
    const without = await median(null);
    const withFade = await median(JUMP_FADE_TIMES);
    console.log(`press to heard: ${without.toFixed(0)} ms without, ${withFade.toFixed(0)} ms with`);
    expect(withFade - without).toBeLessThan(150);
  });

  it('goes silent at once from a pause, and a seek fades too', async () => {
    const file = join(dir, 'seek.pcm');
    const { player, until, sent } = start(
      tracks,
      pcmArgs(file, 'float', [REALTIME]),
      { replayGainMode: 'off' },
      { jumpFade: JUMP_FADE_TIMES },
    );
    player.play([1, 2], 0);
    await until(({ status }) => status === 'playing', 'it to play');
    await wait(500);

    const before = sent().length;
    player.seek(10_000);
    await wait(3_500);
    const seekOrder = sent()
      .slice(before)
      .filter(([name, property]) => name === 'seek' || property === 'volume');
    const seekAt = seekOrder.findIndex(([name]) => name === 'seek');
    expect(seekOrder[seekAt - 1]?.[2]).toBe(0);
    expect(seekOrder.at(-1)?.[2]).toBe(100);

    player.pause();
    await wait(100);
    const paused = sent().length;
    player.playQueueIndex(1);
    const order = sent().slice(paused);
    const volumeAt = order.findIndex(([, property]) => property === 'volume');
    const pauseAt = order.findIndex(([, property]) => property === 'pause');
    expect(order[volumeAt]?.[2]).toBe(0);
    expect(volumeAt).toBeLessThan(pauseAt);
  });
});
