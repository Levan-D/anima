/*
 * The output after the EQ goes off, through the whole Player and mpv's PCM writer, with no forced format, as on a device.
 * The writer's format is the output's, and it starts its file again whenever the output opens, unless told to append.
 * Numbers it prints are the ones in docs/research/audio-verification.md. No device is involved.
 */

import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { EQ_AUTO_PREAMP, sampleFormatWords, type AppSettings, type EqBand, type EqSettings } from '@shared/domain';
import { ffmpeg, FFMPEG, tempDir } from '@main/library/testFixtures';
import {
  decodeAlone,
  fileTrack,
  finishedWriting,
  firstDifference,
  HAS_MPV,
  makeStereoTone,
  startRealPlayer,
  type FileTrack,
  type RealPlayer,
} from './testAudio';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

const PEAK: EqBand = { id: 1, kind: 'peak', frequencyHz: 1000, gainDb: 6, q: 1 };
const EQ_ON: EqSettings = { enabled: true, bands: [PEAK], preamp: EQ_AUTO_PREAMP };
const EQ_OFF: EqSettings = { ...EQ_ON, enabled: false };
const DOUBLES = sampleFormatWords('double');
const CONVERTED = { isBitPerfect: false, kind: 'system', alterations: [`Converted to ${DOUBLES}`] };
const SECONDS = 20;
const FRAMES = SECONDS * 44_100;
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** A decoder other than the one being tested. */
function ffmpegS16(input: string): Buffer {
  const result = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', input, '-f', 's16le', '-'], {
    maxBuffer: 2 ** 31,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`ffmpeg couldn't decode ${input}`);
  return result.stdout;
}

const pcm = (file: string, extra: string[] = []) => [
  '--ao=pcm',
  `--ao-pcm-file=${file}`,
  '--ao-pcm-waveheader=no',
  ...extra,
];
const APPEND = ['--ao-pcm-append=yes'];
const isDoubles = (format: string | undefined) => format !== undefined && sampleFormatWords(format) === DOUBLES;

describe.skipIf(!HAS_MPV)('reopening the output after the EQ goes off', () => {
  let dir: string;
  let running: RealPlayer | null = null;
  let flacs: FileTrack[];

  const start = (tracks: FileTrack[], args: string[], settings: Partial<AppSettings> = {}) => {
    running = startRealPlayer(tracks, args, { replayGainMode: 'off', outputMode: 'exclusive', eq: EQ_ON, ...settings });
    return running;
  };

  beforeAll(() => {
    dir = tempDir('player-reopen');
    flacs = [440, 660, 880].map((frequency, index) => {
      const path = join(dir, `track-${index + 1}.flac`);
      makeStereoTone(path, { frequency, seconds: SECONDS });
      return fileTrack(index + 1, path, {}, SECONDS * 1000);
    });
  });

  afterEach(() => {
    running?.stop();
    running = null;
  });

  const chainGone = ({ sent, until }: RealPlayer) =>
    until(() => sent().some(([name, how]) => name === 'af' && how === 'clr'), 'the chain to go');

  /** In doubles from the EQ, paused before the writer has written anything, with the EQ gone and that settled. */
  async function eqGoneWhilePaused(started: RealPlayer, ids: number[]) {
    await wait(50);
    started.player.play(ids, 0);
    started.player.pause();
    await started.until(
      ({ status, signal }) => status === 'paused' && isDoubles(signal.output?.format),
      'the output in doubles',
    );
    await wait(100);
    started.player.setEq(EQ_OFF);
    await chainGone(started);
    await wait(100);
  }

  it('is in doubles to the boundary and in the file’s own format after it, losing nothing', async () => {
    const file = join(dir, 'appended.pcm');
    const started = start(flacs, pcm(file, APPEND));
    const { player, until, states, notices } = started;
    await eqGoneWhilePaused(started, [1, 2, 3]);
    expect(player.state().signal).toMatchObject(CONVERTED);
    player.resume();
    await until(({ status }) => status === 'ended', 'the end of the queue');
    expect(notices).toEqual([]);

    const output = await finishedWriting(file);
    const [first, second, third] = flacs.map(({ path }) => path) as [string, string, string];
    const following = Buffer.concat([ffmpegS16(second), ffmpegS16(third)]);
    expect(firstDifference(following, Buffer.concat([decodeAlone(second, 's16'), decodeAlone(third, 's16')]))).toBeNull();
    expect(firstDifference(output.subarray(output.length - following.length), following)).toBeNull();

    // What was through the filters before they went comes out first, so the first track is compared from its end.
    const head = output.subarray(0, output.length - following.length);
    const doubles = decodeAlone(first, 'double');
    expect(head.length).toBe(doubles.length);
    let filtered = 0;
    for (let at = head.length - 8; at >= 0; at -= 8) {
      if (head.readDoubleLE(at) !== doubles.readDoubleLE(at)) {
        filtered = (at + 8) / 16;
        break;
      }
    }
    console.log(
      `Reopen: first track ${head.length / 16} of ${FRAMES} frames, all in doubles, ${filtered} of them through the filters before they went; then ${following.length / 4} frames as s16, identical, none lost or added`,
    );
    expect(filtered).toBeLessThan(3 * 44_100);

    // Bit-perfect only with the output really in the file's format, and never on the first track.
    const said = states.filter(({ signal }) => signal.isBitPerfect);
    expect(said.length).toBeGreaterThan(0);
    expect(said.every(({ signal, queueIndex }) => signal.output?.format === 's16' && queueIndex !== 0)).toBe(true);
    const lastOfFirst = states.filter(({ queueIndex, signal }) => queueIndex === 0 && signal.output !== null).at(-1);
    expect(lastOfFirst?.signal).toMatchObject(CONVERTED);
  });

  it('reopens at that one boundary: the writer starts over there and not at the one after', async () => {
    const file = join(dir, 'truncated.pcm');
    const started = start(flacs, pcm(file));
    await eqGoneWhilePaused(started, [1, 2, 3]);
    started.player.resume();
    await started.until(({ status }) => status === 'ended', 'the end of the queue');
    const expected = Buffer.concat([ffmpegS16(flacs[1]?.path ?? ''), ffmpegS16(flacs[2]?.path ?? '')]);
    expect(firstDifference(await finishedWriting(file), expected)).toBeNull();
  });

  it('never reopens mid-song, whatever happens before the boundary', async () => {
    const file = join(dir, 'mid-song.pcm');
    const started = start(flacs, pcm(file, APPEND));
    await eqGoneWhilePaused(started, [1, 2]);
    const { player, until, states } = started;
    player.seek(5000);
    await wait(100);
    player.resume();
    await until(({ status }) => status === 'ended', 'the end of the queue');
    const firstTrack = states.filter(({ queueIndex, signal }) => queueIndex === 0 && signal.output !== null);
    expect(firstTrack.every(({ signal }) => isDoubles(signal.output?.format))).toBe(true);
  });

  it('leaves the output open at the boundary when the EQ stays on, as the control', async () => {
    const file = join(dir, 'eq-stays.pcm');
    const started = start(flacs, pcm(file));
    started.player.play([1, 2], 0);
    await started.until(({ status }) => status === 'ended', 'the end of the queue');
    expect((await finishedWriting(file)).length).toBe(2 * FRAMES * 16);
  });

  it('leaves it for the end of a track when Next jumps, and says so until then', async () => {
    const file = join(dir, 'next.pcm');
    const started = start(flacs, pcm(file));
    await eqGoneWhilePaused(started, [1, 2, 3]);
    started.player.next();
    await started.until(({ signal, queueIndex }) => queueIndex === 1 && signal.output !== null, 'the second track');
    await wait(100);
    expect(started.player.state().signal).toMatchObject(CONVERTED);
    started.player.resume();
    await started.until(({ status }) => status === 'ended', 'the end of the queue');
    expect(firstDifference(await finishedWriting(file), ffmpegS16(flacs[2]?.path ?? ''))).toBeNull();
  });

  it('holds for an MP3, whose own format is float', async () => {
    const mp3s = [440, 660].map((frequency, index) => {
      const path = join(dir, `track-${index + 1}.mp3`);
      ffmpeg('-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=20`, '-ac', '2', '-c:a', 'libmp3lame', path);
      return fileTrack(index + 11, path, {}, SECONDS * 1000);
    });
    const file = join(dir, 'mp3.pcm');
    const started = start(mp3s, pcm(file));
    await eqGoneWhilePaused(started, [11, 12]);
    started.player.resume();
    await started.until(({ status }) => status === 'ended', 'the end of the queue');
    expect(started.states.some(({ signal }) => signal.isBitPerfect)).toBe(true);
    expect(firstDifference(await finishedWriting(file), decodeAlone(mp3s[1]?.path ?? '', 'float'))).toBeNull();
  });

  it('costs this much in real time, on an output with no device', async () => {
    const short = [1, 2].map((id) => {
      const path = join(dir, `short-${id}.flac`);
      makeStereoTone(path, { frequency: 440 + id, seconds: 3 });
      return fileTrack(id, path, {}, 3000);
    });
    const timed = async (eqStartsOn: boolean) => {
      const started = start(short, ['--ao=null'], { eq: eqStartsOn ? EQ_ON : EQ_OFF });
      if (eqStartsOn) await eqGoneWhilePaused(started, [1, 2]);
      else {
        await wait(50);
        started.player.play([1, 2], 0);
        started.player.pause();
        await started.until(({ status, signal }) => status === 'paused' && signal.output !== null, 'the output');
        await wait(100);
      }
      const from = performance.now();
      started.player.resume();
      await started.until(({ status }) => status === 'ended', 'the end of the queue');
      const taken = performance.now() - from;
      started.stop();
      running = null;
      return taken;
    };
    for (let run = 0; run < 3; run++) {
      const gapless = await timed(false);
      const reopened = await timed(true);
      console.log(
        `Boundary on ao=null: gapless ${gapless.toFixed(0)} ms, with the reopen ${reopened.toFixed(0)} ms, so ${(reopened - gapless).toFixed(0)} ms`,
      );
      expect(reopened - gapless).toBeLessThan(1000);
    }
  });

  describe('only when it would help', () => {
    /** Playing, EQ on, in doubles, with a second track held. Long enough that nothing reaches a boundary. */
    async function inDoubles(settings: Partial<AppSettings> = {}) {
      const paths = [1, 2].map((id) => join(dir, `long-${id}.flac`));
      for (const path of paths) makeStereoTone(path, { frequency: 440, seconds: 100 });
      const tracks = paths.map((path, index) => fileTrack(index + 1, path, {}, 100_000));
      const started = start(tracks, ['--ao=null'], settings);
      started.player.play([1, 2], 0);
      await started.until(({ signal }) => isDoubles(signal.output?.format), 'the output in doubles');
      await holdsSoon(started, 2);
      return started;
    }
    const holdsSoon = async ({ ask }: RealPlayer, count: number) => {
      for (let tries = 0; tries < 40 && (await ask('playlist-count')) !== count; tries++) await wait(25);
      expect(await ask('playlist-count')).toBe(count);
    };

    it('not with the volume down, until it comes back up', async () => {
      const started = await inDoubles({ volume: 99 });
      started.player.setEq(EQ_OFF);
      await chainGone(started);
      await wait(200);
      await holdsSoon(started, 2);
      started.player.setVolume(100);
      await holdsSoon(started, 1);
    });

    it('not in shared mode, since Windows is mixing anyway', async () => {
      const started = await inDoubles({ outputMode: 'shared' });
      started.player.setEq(EQ_OFF);
      await chainGone(started);
      await wait(200);
      await holdsSoon(started, 2);
    });

    it('not once the EQ is back on, which holds the next track again', async () => {
      const started = await inDoubles();
      started.player.setEq(EQ_OFF);
      await chainGone(started);
      await holdsSoon(started, 1);
      started.player.setEq(EQ_ON);
      await wait(500);
      await holdsSoon(started, 2);
    });

    it('not when the EQ never changed the format', async () => {
      const paths = [1, 2].map((id) => join(dir, `plain-${id}.flac`));
      for (const path of paths) makeStereoTone(path, { frequency: 440, seconds: 100 });
      const tracks = paths.map((path, index) => fileTrack(index + 1, path, {}, 100_000));
      const plain = start(tracks, ['--ao=null'], { eq: EQ_OFF });
      plain.player.play([1, 2], 0);
      await plain.until(({ signal }) => signal.isBitPerfect, 'bit-perfect');
      plain.player.setEq(EQ_ON);
      await wait(500);
      plain.player.setEq(EQ_OFF);
      await wait(500);
      await holdsSoon(plain, 2);
      expect(plain.player.state().signal.isBitPerfect).toBe(true);
    });
  });

  describe('within a CUE file', () => {
    /** Two stretches of one file, then another file. A `gapMs` of 0 makes them one stretch to mpv. */
    function ranges(gapMs: number): FileTrack[] {
      const shared = join(dir, `cue-${gapMs}.flac`);
      makeStereoTone(shared, { frequency: 500, seconds: 30 });
      const other = flacs[2] as FileTrack;
      return [
        fileTrack(21, shared, { fileId: 900, startMs: 0, endMs: 5000 }, 5000),
        fileTrack(22, shared, { fileId: 900, startMs: 5000 + gapMs, endMs: 10_000 + gapMs }, 5000),
        { ...other, track: { ...other.track, id: 23 }, range: { fileId: 901, startMs: 0, endMs: null } },
      ];
    }

    it.each([
      ['the next track following on, as one stretch', 0],
      ['the next track further along the same file', 2000],
    ])('leaves it for the next real boundary, with %s', async (_name, gapMs) => {
      const tracks = ranges(gapMs);
      const file = join(dir, `cue-${gapMs}.pcm`);
      const started = start(tracks, pcm(file, APPEND));
      await eqGoneWhilePaused(started, [21, 22, 23]);
      started.player.resume();
      await started.until(({ status }) => status === 'ended', 'the end of the queue');
      const after = ffmpegS16(tracks[2]?.path ?? '');
      const output = await finishedWriting(file);
      // Both stretches in doubles, so no reopen between them, and then the other file in its own format.
      expect((output.length - after.length) / 16).toBeCloseTo(10 * 44_100, -1);
      expect(firstDifference(output.subarray(output.length - after.length), after)).toBeNull();
    });
  });

  describe('pause and stop', () => {
    it('keep the output open in exclusive: it stays, and the writer never starts over', async () => {
      const path = join(dir, 'hold.flac');
      makeStereoTone(path, { frequency: 440, seconds: 400 });
      const file = join(dir, 'hold.pcm');
      const { player, until, ask, sent } = start([fileTrack(1, path, {}, 400_000)], pcm(file), { eq: EQ_OFF });
      const size = () => statSync(file, { throwIfNoEntry: false })?.size ?? 0;

      await wait(50);
      player.play([1], 0);
      player.pause();
      await until(({ status, signal }) => status === 'paused' && signal.output !== null, 'the output');
      player.resume();
      while (size() < 1_000_000) await new Promise((done) => setImmediate(done));

      player.pause();
      await wait(200);
      expect(await ask('current-ao')).toBe('pcm');
      const paused = size();
      expect(paused).toBeGreaterThanOrEqual(1_000_000);

      player.stop();
      await wait(200);
      expect(player.state()).toMatchObject({ status: 'paused', signal: { isBitPerfect: true } });
      expect(await ask('current-ao')).toBe('pcm');
      expect(sent().filter(([name]) => name === 'stop' || name === 'ao-reload')).toEqual([]);

      player.resume();
      await until(({ status }) => status === 'ended', 'the end of the queue');
      const whole = decodeAlone(path, 's16');
      const output = await finishedWriting(file);
      // All of it again after what was already written, so the file only ever grew.
      expect(output.length).toBeGreaterThanOrEqual(paused + whole.length);
      expect(firstDifference(output.subarray(output.length - whole.length), whole)).toBeNull();
    });
  });
});
