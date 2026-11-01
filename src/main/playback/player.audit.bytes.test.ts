/*
 * What docs/research/audio-verification.md claims, on generated files, through the whole Player and mpv's PCM writer. No
 * device is involved. Numbers it prints are the ones in that table.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { EQ_AUTO_PREAMP, type EqBand, type EqSettings } from '@shared/domain';
import { clipDb, curveDb, effectivePreampDb, preampDb } from '@shared/eqCurve';
import { ffmpeg, FFMPEG, tempDir } from '@main/library/testFixtures';
import { chainFor, chainSpec } from './eqChain';
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

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const PEAK: EqBand = { id: 1, kind: 'peak', frequencyHz: 1000, gainDb: 6, q: 1 };
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
const peakOf = (samples: Float32Array) => samples.reduce((top, sample) => Math.max(top, Math.abs(sample)), 0);

/** Raw PCM by ffmpeg, a decoder other than the one being tested. */
function ffmpegDecode(input: string, format: 's16le' | 's32le'): Buffer {
  const result = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', input, '-f', format, '-'], {
    maxBuffer: 2 ** 31,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`ffmpeg couldn't decode ${input}`);
  return result.stdout;
}

/** 16-bit stereo where every frame's left sample says which frame it is, modulo the 16 bits. */
function writeCounting(path: string, rate: number, seconds: number): void {
  const frames = rate * seconds;
  const data = Buffer.alloc(frames * 4);
  for (let frame = 0; frame < frames; frame++) {
    data.writeInt16LE((frame % 65_536) - 32_768, frame * 4);
    data.writeInt16LE(((frame * 7) % 65_536) - 32_768, frame * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  const wav = `${path}.source.wav`;
  writeFileSync(wav, Buffer.concat([header, data]));
  ffmpeg('-i', wav, path);
}

describe.skipIf(!HAS_MPV)('the audit, on generated files', () => {
  let dir: string;
  let running: RealPlayer | null = null;
  const start = (...args: Parameters<typeof startRealPlayer>) => {
    running = startRealPlayer(...args);
    return running;
  };

  beforeAll(() => {
    dir = tempDir('player-audit');
  });

  afterEach(() => {
    running?.stop();
    running = null;
  });

  function flac(
    name: string,
    frequency: number,
    seconds: number,
    id: number,
    tags: Record<string, string> = {},
  ): FileTrack {
    const path = join(dir, `${name}.flac`);
    if (!existsSync(path)) makeStereoTone(path, { frequency, seconds, tags });
    return fileTrack(id, path, {}, seconds * 1000);
  }

  async function playToEnd(tracks: FileTrack[], ids: number[], file: string, format: 's32' | 'float', settings = {}) {
    const player = start(tracks, pcmArgs(file, format), { replayGainMode: 'off', ...settings });
    player.player.play(ids, 0);
    await player.until(({ status }) => status === 'ended', 'the end of the queue');
    expect(player.notices).toEqual([]);
    return finishedWriting(file);
  }

  describe('gapless', () => {
    it('holds after a queue change: what follows is what the queue now says, byte for byte', async () => {
      const tracks = [flac('q1', 440, 30, 1), flac('q2', 550, 30, 2), flac('q3', 660, 30, 3)];
      const file = join(dir, 'queue-change.pcm');
      const { player, until, sent, notices } = start(tracks, pcmArgs(file, 's32'), { replayGainMode: 'off' });
      player.play([1, 2], 0);
      player.pause();
      await until(({ status }) => status === 'paused', 'the file to load');
      await wait(100);
      expect(sent().filter(([name]) => name === 'loadfile')).toHaveLength(2);

      // Paused before the writer can get anywhere: 3 goes in ahead of 2, which is what mpv held as next.
      player.enqueue([3], 'next');
      await wait(100);
      expect(sent().filter(([name]) => name === 'playlist-remove')).toHaveLength(1);
      player.resume();
      await until(({ status }) => status === 'ended', 'the end of the queue');

      expect(notices).toEqual([]);
      const expected = Buffer.concat([1, 3, 2].map((id) => decodeAlone(tracks[id - 1]?.path ?? '', 's32')));
      expect(firstDifference(await finishedWriting(file), expected)).toBeNull();
    });

    it('holds at an Endless boundary: a track it adds follows byte for byte', async () => {
      const tracks = [flac('r1', 330, 30, 1), flac('r2', 390, 30, 2)];
      const file = join(dir, 'endless.pcm');
      let gave = 0;
      const { player, until, sent } = start(
        tracks,
        pcmArgs(file, 's32'),
        { replayGainMode: 'off', endless: true },
        { suggest: () => Promise.resolve({ trackIds: gave++ === 0 ? [2] : [], hasSignals: true }) },
      );
      player.play([1], 0);
      player.pause();
      await until(({ status }) => status === 'paused', 'the file to load');
      await until(({ queueLength }) => queueLength === 2, 'Endless to add');
      await wait(100);
      expect(sent().filter(([name, , mode]) => name === 'loadfile' && mode === 'append')).toHaveLength(1);

      expect(player.state().queueLength).toBe(2);
      player.resume();
      await until(({ status }) => status === 'ended', 'the end of the queue');
      const expected = Buffer.concat(tracks.map(({ path }) => decodeAlone(path, 's32')));
      expect(firstDifference(await finishedWriting(file), expected)).toBeNull();
    });

    it('holds with EQ on across files of different content, each filtered as if alone', async () => {
      const tracks = [flac('e1', 700, 20, 1), flac('e2', 1000, 21, 2)];
      const eq: EqSettings = { enabled: true, bands: [PEAK], preamp: EQ_AUTO_PREAMP };
      const output = await playToEnd(tracks, [1, 2], join(dir, 'eq.pcm'), 'float', { eq });
      const args = [`--af=${chainSpec(chainFor(eq))}`];
      const expected = Buffer.concat(tracks.map(({ path }) => decodeAlone(path, 'float', args)));
      expect(firstDifference(output, expected)).toBeNull();
    });

    it('reopens between files of different rates, with nothing lost', async () => {
      const low = join(dir, 'rate-44.flac');
      const high = join(dir, 'rate-48.flac');
      makeStereoTone(low, { frequency: 440, seconds: 10, rate: 44_100 });
      makeStereoTone(high, { frequency: 440, seconds: 10, rate: 48_000 });
      const tracks = [fileTrack(1, low, {}, 10_000), fileTrack(2, high, {}, 10_000)];
      const file = join(dir, 'rates.pcm');
      const { player, until } = start(tracks, pcmArgs(file, 's32'), { replayGainMode: 'off' });
      player.play([1, 2], 0);
      await until(({ status }) => status === 'ended', 'the end of the queue');
      // The writer truncates when it reopens, so only the second file's bytes are left, whole: the output really did reopen.
      const output = await finishedWriting(file);
      expect(firstDifference(output, decodeAlone(high, 's32'))).toBeNull();
    });
  });

  describe('MP3', () => {
    const FRAMES_EACH = 30 * 44_100;
    let tagged: FileTrack[];
    let untagged: FileTrack[];
    let source: Buffer;

    beforeAll(() => {
      // One long signal, cut at a sample that isn't a frame boundary, then encoded as two files, as an album would be.
      const whole = join(dir, 'mp3-source.wav');
      ffmpeg(
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=997:duration=61:sample_rate=44100',
        '-af',
        'volume=2',
        '-ac',
        '2',
        '-c:a',
        'pcm_s16le',
        whole,
      );
      source = ffmpegDecode(whole, 's16le');
      const cut = (name: string, startFrame: number, xing: string, id: number): FileTrack => {
        const path = join(dir, `${name}.mp3`);
        const times = [
          '-af',
          `atrim=start_sample=${startFrame}:end_sample=${startFrame + FRAMES_EACH},asetpts=N/SR/TB`,
        ];
        ffmpeg('-i', whole, ...times, '-c:a', 'libmp3lame', '-b:a', '192k', '-write_xing', xing, path);
        return fileTrack(id, path, {}, 30_000);
      };
      tagged = [cut('lame-1', 0, '1', 1), cut('lame-2', FRAMES_EACH, '1', 2)];
      untagged = [cut('plain-1', 0, '0', 3), cut('plain-2', FRAMES_EACH, '0', 4)];
    });

    it('is byte-identical to each decoded alone, with a LAME header, and exactly the source’s length', async () => {
      const output = await playToEnd(tagged, [1, 2], join(dir, 'mp3-lame.pcm'), 'float');
      const alone = tagged.map(({ path }) => decodeAlone(path, 'float'));
      expect(firstDifference(output, Buffer.concat(alone))).toBeNull();
      expect(alone.map((bytes) => bytes.length / 8)).toEqual([FRAMES_EACH, FRAMES_EACH]);

      // Against the source: how close the decode is either side of the join, and at the join itself.
      const out = floatsOf(output);
      const errorAt = (frame: number) => Math.abs((out[frame * 2] ?? 0) - source.readInt16LE(frame * 4) / 32_768);
      const worstIn = (from: number, to: number) => {
        let worst = 0;
        for (let frame = from; frame < to; frame++) worst = Math.max(worst, errorAt(frame));
        return worst;
      };
      const away = worstIn(FRAMES_EACH / 2, FRAMES_EACH / 2 + 4410);
      const atJoin = worstIn(FRAMES_EACH - 2000, FRAMES_EACH + 2000);
      console.log(
        `MP3 with LAME: frames each ${FRAMES_EACH}; worst error from the source mid-file ${away.toFixed(5)}, around the join ${atJoin.toFixed(5)}`,
      );
      expect(atJoin).toBeLessThan(0.05);
    });

    it('can’t be gapless without one: the decoder’s delay and padding stay in, as silence', async () => {
      const output = await playToEnd(untagged, [3, 4], join(dir, 'mp3-plain.pcm'), 'float');
      const alone = untagged.map(({ path }) => decodeAlone(path, 'float'));
      expect(firstDifference(output, Buffer.concat(alone))).toBeNull();
      const extra = alone.map((bytes) => bytes.length / 8 - FRAMES_EACH);
      const out = floatsOf(output);
      const seam = (alone[0]?.length ?? 0) / 8;
      let silent = 0;
      for (let frame = seam + 2000; frame > seam - 3000; frame--) {
        if (Math.abs(out[frame * 2] ?? 0) < 0.0005) silent++;
      }
      console.log(
        `MP3 with no LAME header: ${extra.join(', ')} frames longer than the source, ${silent} near-silent frames around the join`,
      );
      expect(extra.every((frames) => frames > 0)).toBe(true);
      expect(silent).toBeGreaterThan(100);
    });
  });

  describe('bit-perfect', () => {
    it('is what an independent decoder gets, at volume 100, EQ off and ReplayGain off: 16-bit', async () => {
      const item = flac('bp16', 440, 15, 1);
      const file = join(dir, 'bp16.pcm');
      const { player, until } = start([item], pcmArgs(file, 's32', ['--audio-format=s16']), {
        replayGainMode: 'off',
        volume: 100,
      });
      player.play([1], 0);
      await until(({ status }) => status === 'ended', 'the end of the queue');
      expect(firstDifference(await finishedWriting(file), ffmpegDecode(item.path, 's16le'))).toBeNull();
    });

    it('is the same for 24-bit, in s32', async () => {
      const path = join(dir, 'bp24.flac');
      ffmpeg(
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=10:sample_rate=96000',
        '-ac',
        '2',
        '-sample_fmt',
        's32',
        '-strict',
        'experimental',
        '-bits_per_raw_sample',
        '24',
        path,
      );
      const item = fileTrack(1, path, {}, 10_000);
      const output = await playToEnd([item], [1], join(dir, 'bp24.pcm'), 's32');
      expect(firstDifference(output, ffmpegDecode(path, 's32le'))).toBeNull();
    });

    it('is touched by volume 99, which is why the status says so', async () => {
      const item = flac('bp99', 440, 5, 1);
      const output = await playToEnd([item], [1], join(dir, 'bp99.pcm'), 's32', { volume: 99 });
      expect(firstDifference(output, decodeAlone(item.path, 's32'))).not.toBeNull();
    });
  });

  describe('ReplayGain', () => {
    type Case = {
      name: string;
      tags: Record<string, string>;
      track: number;
      album: number;
    };
    // What mpv's decode_rgain and compute_replaygain say, and each is measured against it.
    const CASES: Case[] = [
      {
        name: 'both, with room',
        tags: {
          REPLAYGAIN_TRACK_GAIN: '-6 dB',
          REPLAYGAIN_TRACK_PEAK: '0.5',
          REPLAYGAIN_ALBUM_GAIN: '-9 dB',
          REPLAYGAIN_ALBUM_PEAK: '0.5',
        },
        track: -6,
        album: -9,
      },
      {
        name: 'a boost its peak has room for',
        tags: { REPLAYGAIN_TRACK_GAIN: '+6 dB', REPLAYGAIN_TRACK_PEAK: '0.25' },
        track: 6,
        album: 6,
      },
      {
        name: 'a boost cut short by its peak',
        tags: { REPLAYGAIN_TRACK_GAIN: '+12 dB', REPLAYGAIN_TRACK_PEAK: '0.5' },
        track: 6.02,
        album: 6.02,
      },
      {
        name: 'a boost with no peak tag, which counts as 1',
        tags: { REPLAYGAIN_TRACK_GAIN: '+6 dB' },
        track: 0,
        album: 0,
      },
      { name: 'a cut with no peak tag', tags: { REPLAYGAIN_TRACK_GAIN: '-3 dB' }, track: -3, album: -3 },
      {
        name: 'album gain with no album peak, on a boost',
        tags: { REPLAYGAIN_TRACK_GAIN: '-1 dB', REPLAYGAIN_ALBUM_GAIN: '+4 dB' },
        track: -1,
        album: 0,
      },
      { name: 'an album gain alone, which mpv ignores', tags: { REPLAYGAIN_ALBUM_GAIN: '-5 dB' }, track: 0, album: 0 },
      {
        name: 'a peak it can’t read, which loses the track’s gain too',
        tags: { REPLAYGAIN_TRACK_GAIN: '-5 dB', REPLAYGAIN_TRACK_PEAK: 'loud' },
        track: 0,
        album: 0,
      },
      { name: 'a gain it can’t read', tags: { REPLAYGAIN_TRACK_GAIN: 'loud' }, track: 0, album: 0 },
      { name: 'no tags', tags: {}, track: 0, album: 0 },
      { name: 'lower-case tag names', tags: { replaygain_track_gain: '-4 dB' }, track: -4, album: -4 },
    ];
    const GAIN = 'ReplayGain is changing the level';

    it.each(CASES)('measures and says the same for a FLAC with $name', async ({ name, tags, track, album }) => {
      const path = join(dir, `rg-${CASES.findIndex((one) => one.name === name)}.flac`);
      makeStereoTone(path, { frequency: 440, seconds: 3, tags });
      const item = fileTrack(1, path, {}, 3000);
      const reference = rms(floatsOf(decodeAlone(path, 'float')));
      for (const [mode, expected] of [
        ['off', 0],
        ['track', track],
        ['album', album],
      ] as const) {
        const file = `${path}.${mode}.pcm`;
        const { player, until, stop } = startRealPlayer([item], pcmArgs(file, 'float'), { replayGainMode: mode });
        try {
          player.play([1], 0);
          // While it's open, since the status says nothing once the file has gone.
          const seen: string[][] = [];
          await until(({ status, signal }) => {
            if (signal.output !== null) seen.push(signal.alterations);
            return status === 'ended';
          }, 'the end of the queue');
          const measured = decibels(rms(floatsOf(await finishedWriting(file))), reference);
          expect(Math.abs(measured - expected), `${name}, ${mode}: ${measured}`).toBeLessThan(0.02);
          const said = seen.some((alterations) => alterations.includes(GAIN));
          console.log(
            `RG ${name}, ${mode}: tagged ${expected}, measured ${measured.toFixed(3)}, status says changing: ${said}`,
          );
          if (expected === 0) expect(said, `${name}, ${mode}`).toBe(false);
        } finally {
          stop();
        }
      }
    });

    it('reads tags from an MP3 too', async () => {
      const path = join(dir, 'rg.mp3');
      ffmpeg(
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=5:sample_rate=44100',
        '-af',
        'volume=2',
        '-ac',
        '2',
        '-metadata',
        'REPLAYGAIN_TRACK_GAIN=-6.00 dB',
        '-metadata',
        'REPLAYGAIN_ALBUM_GAIN=-9.00 dB',
        '-c:a',
        'libmp3lame',
        path,
      );
      const item = fileTrack(1, path, {}, 5000);
      const reference = rms(floatsOf(decodeAlone(path, 'float')));
      for (const [mode, expected] of [
        ['track', -6],
        ['album', -9],
      ] as const) {
        const file = `${path}.${mode}.pcm`;
        const { player, until, stop } = startRealPlayer([item], pcmArgs(file, 'float'), { replayGainMode: mode });
        try {
          player.play([1], 0);
          await until(({ status }) => status === 'ended', 'the end of the queue');
          expect(Math.abs(decibels(rms(floatsOf(await finishedWriting(file))), reference) - expected)).toBeLessThan(
            0.02,
          );
        } finally {
          stop();
        }
      }
    });
  });

  describe('the volume law', () => {
    const LEVELS = [100, 90, 75, 50, 25, 10, 1];

    it.each(LEVELS)('at %i is 60·log10(v/100) dB', async (volume) => {
      const item = flac('law', 440, 3, 1);
      const reference = rms(floatsOf(decodeAlone(item.path, 'float')));
      const output = await playToEnd([item], [1], join(dir, `law-${volume}.pcm`), 'float', { volume });
      const measured = decibels(rms(floatsOf(output)), reference);
      const expected = 60 * Math.log10(volume / 100);
      console.log(`Volume ${volume}: measured ${measured.toFixed(3)} dB, law ${expected.toFixed(3)} dB`);
      expect(Math.abs(measured - expected)).toBeLessThan(0.02);
    });

    it('is silence when muted', async () => {
      const item = flac('mute', 440, 3, 1);
      const output = await playToEnd([item], [1], join(dir, 'muted.pcm'), 'float', { muted: true });
      expect(peakOf(floatsOf(output))).toBe(0);
    });
  });

  describe('the preamp and its note', () => {
    // A true full-scale tone: mono to stereo through pan, which doesn't take 3 dB off as -ac does.
    function fullScale(name: string, frequency: number): FileTrack {
      const path = join(dir, `${name}.flac`);
      ffmpeg(
        '-f',
        'lavfi',
        '-i',
        `aevalsrc=0.99999*sin(2*PI*${frequency}*t):s=44100:d=5`,
        '-af',
        'pan=stereo|c0=c0|c1=c0',
        '-sample_fmt',
        's16',
        path,
      );
      return fileTrack(1, path, {}, 5000);
    }

    it.each([
      ['Auto', [PEAK], EQ_AUTO_PREAMP],
      ['-7 by hand, what Auto would be', [PEAK], { auto: false, db: -7 }],
      ['-6 by hand, the top of the curve', [PEAK], { auto: false, db: -6 }],
      ['-3 by hand', [PEAK], { auto: false, db: -3 }],
      ['+3 by hand', [PEAK], { auto: false, db: 3 }],
      ['+2 by hand, on no bands', [], { auto: false, db: 2 }],
    ] as const)('reaches what the curve says on a full-scale tone at its peak: %s', async (name, bands, preamp) => {
      const item = fullScale('full-1k', 1000);
      const eq: EqSettings = { enabled: true, bands: [...bands], preamp };
      const samples = floatsOf(await playToEnd([item], [1], join(dir, `pre-${name.slice(0, 2)}.pcm`), 'float', { eq }));
      const level = 20 * Math.log10(peakOf(samples));
      const expected = curveDb(eq.bands, 1000, 44_100) + effectivePreampDb(eq);
      console.log(
        `Preamp ${name}: applied ${effectivePreampDb(eq)}, tone reaches ${level.toFixed(2)} dBFS, note says +${clipDb(eq)}`,
      );
      expect(Math.abs(level - expected)).toBeLessThan(0.05);
      expect(level).toBeLessThanOrEqual(Math.max(clipDb(eq), 0) + 0.05);
    });

    it('stays over full scale in float, and clips when it has to go out in integers, whatever the volume after it', async () => {
      const item = fullScale('full-over', 1000);
      const eq: EqSettings = { enabled: true, bands: [], preamp: { auto: false, db: 6 } };
      const floats = floatsOf(await playToEnd([item], [1], join(dir, 'over-float.pcm'), 'float', { eq }));
      expect(20 * Math.log10(peakOf(floats))).toBeCloseTo(6, 1);

      const file = join(dir, 'over-s16.pcm');
      const { player, until, stop } = startRealPlayer([item], pcmArgs(file, 's32', ['--audio-format=s16']), {
        replayGainMode: 'off',
        eq,
        volume: 50,
      });
      try {
        player.play([1], 0);
        await until(({ status }) => status === 'ended', 'the end of the queue');
        const bytes = await finishedWriting(file);
        let top = 0;
        for (let at = 0; at + 2 <= bytes.length; at += 2) top = Math.max(top, Math.abs(bytes.readInt16LE(at)));
        // Full-scale minus 18.06 dB if it clipped first. 6 dB higher if the volume had come ahead of the conversion.
        const db = 20 * Math.log10(top / 32_768);
        console.log(`+6 dB preamp, volume 50, going out as s16: tops out at ${db.toFixed(2)} dBFS`);
        expect(Math.abs(db - -18.06)).toBeLessThan(0.1);
      } finally {
        stop();
      }
    });
  });

  describe('stop, seek and restore', () => {
    const EQ: EqSettings = {
      enabled: true,
      bands: [PEAK, { ...PEAK, id: 2, kind: 'lowshelf', frequencyHz: 200, gainDb: 3, q: 0.7 }],
      preamp: EQ_AUTO_PREAMP,
    };
    const LONG = 200;

    /** Lets a stretch out, then does something, then runs to the end. What's after the stretch is what's being tested. */
    async function afterAStretch(tracks: FileTrack[], file: string, then: (player: RealPlayer['player']) => void) {
      const started = start(tracks, pcmArgs(file, 'float'), { replayGainMode: 'off', eq: EQ });
      const size = () => statSync(file, { throwIfNoEntry: false })?.size ?? 0;
      const settled = async () => {
        let last = -1;
        for (let same = 0; same < 3;) {
          await wait(25);
          const now = size();
          same = now === last ? same + 1 : 0;
          last = now;
        }
        return last;
      };
      await wait(50);
      started.player.play([tracks[0]?.track.id ?? 1], 0);
      started.player.pause();
      await started.until(({ status }) => status === 'paused', 'the file to load');
      const before = await settled();
      started.player.resume();
      while (size() < before + 44_100 * 8 * 5) await new Promise((done) => setImmediate(done));
      started.player.pause();
      const stretch = await settled();
      then(started.player);
      await wait(100);
      started.player.resume();
      await started.until(({ status }) => status === 'ended', 'the end of the queue');
      return { output: await finishedWriting(file), stretch };
    }

    it.each([60, 137.5])(
      'leaves no filter state behind a seek to %s s: the rest is that spot filtered from fresh',
      async (seconds) => {
        const item = flac('seek-eq', 1000, LONG, 1);
        const file = join(dir, `seek-${seconds}.pcm`);
        const { output } = await afterAStretch([item], file, (player) => player.seek(seconds * 1000));
        const fresh = decodeAlone(item.path, 'float', [`--af=${chainSpec(chainFor(EQ))}`, `--start=${seconds}`]);
        const tail = output.subarray(output.length - fresh.length);
        expect(firstDifference(tail, fresh)).toBeNull();
      },
    );

    it('leaves no filter state behind Stop: Play starts from the top, filtered from fresh', async () => {
      const item = flac('stop-eq', 1000, 60, 1);
      const { output } = await afterAStretch([item], join(dir, 'stop.pcm'), (player) => player.stop());
      const fresh = decodeAlone(item.path, 'float', [`--af=${chainSpec(chainFor(EQ))}`]);
      expect(firstDifference(output.subarray(output.length - fresh.length), fresh)).toBeNull();
    });

    /** The counting file repeats every 65,536 frames, so this says where within that. */
    const firstFrameOf = (bytes: Buffer, every: Buffer): number => every.indexOf(bytes.subarray(0, 800)) / 4;

    it.each([1.0, 7.25, 33.333])('lands on the sample asked for, in a FLAC, seeking to %s s', async (seconds) => {
      const path = join(dir, 'counting.flac');
      if (!existsSync(path)) writeCounting(path, 44_100, 60);
      const item = fileTrack(1, path, {}, 60_000);
      const file = join(dir, `counting-${seconds}.pcm`);
      const { player, until, notices, positions } = start([item], pcmArgs(file, 's32', ['--audio-format=s16']), {
        replayGainMode: 'off',
      });
      await wait(50);
      player.play([1], 0);
      player.pause();
      await until(({ status }) => status === 'paused', 'the file to load');
      await wait(100);
      player.seek(seconds * 1000);
      await wait(100);
      const shownMs = positions.at(-1)?.positionMs;
      player.resume();
      await until(({ status }) => status === 'ended', 'the end of the queue');
      expect(notices).toEqual([]);

      const landed = firstFrameOf(await finishedWriting(file), ffmpegDecode(path, 's16le'));
      const wanted = Math.round(seconds * 44_100);
      const off = ((((landed - wanted) % 65_536) + 65_536 + 32_768) % 65_536) - 32_768;
      console.log(`FLAC seek ${seconds} s: ${off} frames off, shown ${shownMs} ms`);
      expect(shownMs).toBe(seconds * 1000);
      expect(Math.abs(off)).toBeLessThanOrEqual(1);
    });

    it('lands near the sample asked for in an MP3', async () => {
      const path = join(dir, 'seek.mp3');
      ffmpeg(
        '-f',
        'lavfi',
        '-i',
        'anoisesrc=d=60:c=pink:r=44100:a=0.3:s=7',
        '-ac',
        '2',
        '-c:a',
        'libmp3lame',
        '-b:a',
        '192k',
        path,
      );
      const item = fileTrack(1, path, {}, 60_000);
      const whole = floatsOf(decodeAlone(path, 'float'));
      for (const seconds of [7.25, 33.333]) {
        const file = join(dir, `seek-mp3-${seconds}.pcm`);
        const { player, until, stop } = startRealPlayer([item], pcmArgs(file, 'float'), { replayGainMode: 'off' });
        try {
          await wait(50);
          player.play([1], 0);
          player.pause();
          await until(({ status }) => status === 'paused', 'the file to load');
          await wait(100);
          player.seek(seconds * 1000);
          await wait(100);
          player.resume();
          await until(({ status }) => status === 'ended', 'the end of the queue');
          const out = floatsOf(await finishedWriting(file));

          // Where a stretch from the middle of what came out sits in the file decoded whole, nearest first. It skips the
          // start of the output, since a decoder's first frames after a seek differ from a run-up.
          const skip = 44_100;
          const wanted = Math.round(seconds * 44_100);
          let best = { frame: -1, error: Number.POSITIVE_INFINITY };
          for (let shift = -4410; shift <= 4410; shift++) {
            let error = 0;
            for (let at = 0; at < 800; at++)
              error += Math.abs((out[(skip + at) * 2] ?? 0) - (whole[(wanted + shift + skip + at) * 2] ?? 0));
            if (error < best.error) best = { frame: wanted + shift, error };
          }
          console.log(
            `MP3 seek ${seconds} s: landed ${best.frame - wanted} frames off, ${((best.frame - wanted) / 44.1).toFixed(2)} ms, match error ${best.error.toFixed(4)}`,
          );
          expect(Math.abs(best.frame - wanted)).toBeLessThanOrEqual(4410);
        } finally {
          stop();
        }
      }
    });
  });

  describe('the EQ moving', () => {
    // Without a forced format, as on a device. mpv keeps its output open in the format it first opened in, which the manual
    // says of gapless-audio=weak. So turning the EQ off doesn't by itself get bit-perfect back, and the status has to say so.
    it('keeps the output in its first format when the EQ goes off, and says it isn’t bit-perfect', async () => {
      const item = flac('reopen', 1000, 400, 1);
      const on: EqSettings = { enabled: true, bands: [PEAK], preamp: EQ_AUTO_PREAMP };
      const { player, until, ask, sent, states } = start([item], ['--ao=null'], {
        replayGainMode: 'off',
        outputMode: 'exclusive',
        eq: on,
      });
      player.play([1], 0);
      await until(({ signal }) => signal.output !== null, 'the output');
      await wait(200);
      const formatOf = () => ask('audio-out-params/format');
      const before = await formatOf();
      player.setEq({ ...on, bands: [{ ...PEAK, gainDb: 3 }] });
      await wait(500);
      const moved = await formatOf();
      player.setEq({ ...on, enabled: false });
      await wait(500);
      const off = await formatOf();
      console.log(
        `Output format with EQ on ${String(before)}, after moving a band ${String(moved)}, EQ off ${String(off)}`,
      );
      expect(moved).toBe(before);
      expect(off).toBe(before);
      expect(sent().filter(([name]) => name === 'loadfile')).toHaveLength(1);
      expect(states.at(-1)?.signal).toMatchObject({
        isBitPerfect: false,
        kind: 'system',
        alterations: ['Converted to 64-bit float'],
      });
    });

    it('keeps the file’s own format when the EQ comes on during it, so its overs meet the output there', async () => {
      const item = flac('reopen-2', 1000, 400, 1);
      const on: EqSettings = { enabled: true, bands: [PEAK], preamp: EQ_AUTO_PREAMP };
      const { player, until, ask } = start([item], ['--ao=null'], { replayGainMode: 'off', outputMode: 'exclusive' });
      player.play([1], 0);
      await until(({ signal }) => signal.kind === 'bit-perfect', 'bit-perfect');
      expect(await ask('audio-out-params/format')).toBe('s16');
      player.setEq(on);
      await until(({ signal }) => signal.alterations.includes('EQ is on'), 'the status');
      await wait(500);
      expect(await ask('audio-out-params/format')).toBe('s16');
      expect(player.state().signal).toMatchObject({ kind: 'adjusted', alterations: ['EQ is on'] });
    });
  });

  describe('the signal status, truth table', () => {
    type Row = {
      name: string;
      args?: string[];
      settings?: Parameters<typeof startRealPlayer>[2];
      kind: string;
      alterations: string[];
      isMp3?: boolean;
    };
    const EQ_ON: EqSettings = { enabled: true, bands: [PEAK], preamp: EQ_AUTO_PREAMP };
    const ROWS: Row[] = [
      {
        name: 'exclusive, nothing altering',
        settings: { outputMode: 'exclusive' },
        kind: 'bit-perfect',
        alterations: [],
      },
      { name: 'shared', settings: { outputMode: 'shared' }, kind: 'system', alterations: ['Windows is mixing'] },
      {
        name: 'EQ on',
        settings: { outputMode: 'exclusive', eq: EQ_ON },
        kind: 'adjusted',
        alterations: ['EQ is on', 'Converted to 64-bit float'],
      },
      {
        name: 'EQ on but flat',
        settings: { outputMode: 'exclusive', eq: { ...EQ_ON, bands: [{ ...PEAK, gainDb: 0 }] } },
        kind: 'bit-perfect',
        alterations: [],
      },
      {
        name: 'EQ with less room than Auto',
        settings: { outputMode: 'exclusive', eq: { ...EQ_ON, preamp: { auto: false, db: 0 } } },
        kind: 'adjusted',
        alterations: ['EQ is on', 'EQ may clip by about +7 dB', 'Converted to 64-bit float'],
      },
      {
        name: 'volume 99',
        settings: { outputMode: 'exclusive', volume: 99 },
        kind: 'adjusted',
        alterations: ['Volume is below 100'],
      },
      { name: 'muted', settings: { outputMode: 'exclusive', muted: true }, kind: 'adjusted', alterations: ['Muted'] },
      {
        name: 'resampled',
        args: ['--audio-samplerate=48000'],
        settings: { outputMode: 'exclusive' },
        kind: 'system',
        alterations: ['Resampled to 48 kHz'],
      },
      {
        name: 'converted',
        args: ['--audio-format=s32'],
        settings: { outputMode: 'exclusive' },
        kind: 'system',
        alterations: ['Converted to 32-bit'],
      },
      {
        name: 'downmixed',
        args: ['--audio-channels=mono'],
        settings: { outputMode: 'exclusive' },
        kind: 'system',
        alterations: ['Mixed to mono'],
      },
      {
        name: 'adjusted and altered, where the system wins',
        args: ['--audio-samplerate=48000'],
        settings: { outputMode: 'exclusive', volume: 50 },
        kind: 'system',
        alterations: ['Volume is below 100', 'Resampled to 48 kHz'],
      },
      {
        name: 'an MP3, which decodes to float, going out as float',
        settings: { outputMode: 'exclusive' },
        kind: 'bit-perfect',
        alterations: [],
        isMp3: true,
      },
      {
        name: 'an MP3 going out as 16-bit',
        args: ['--audio-format=s16'],
        settings: { outputMode: 'exclusive' },
        kind: 'system',
        alterations: ['Converted to 16-bit'],
        isMp3: true,
      },
    ];

    it.each(ROWS)('says $kind for $name', async ({ args = [], settings = {}, kind, alterations, isMp3 = false }) => {
      const path = join(dir, isMp3 ? 'signal.mp3' : 'signal.flac');
      if (!existsSync(path)) {
        if (isMp3) ffmpeg('-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', '-ac', '2', '-c:a', 'libmp3lame', path);
        else makeStereoTone(path, { frequency: 440, seconds: 8 });
      }
      const item = fileTrack(1, path, {}, 8000);
      const { player, until } = start([item], ['--ao=null', ...args], { replayGainMode: 'off', ...settings });
      player.play([1], 0);
      await until(({ signal }) => signal.output !== null && signal.decoded !== null, 'the signal');
      await wait(200);
      const { signal } = player.state();
      console.log(
        `Signal ${kind}: decoded ${signal.decoded?.format} ${signal.decoded?.sampleRate}, out ${signal.output?.format} ${signal.output?.sampleRate} ${signal.output?.channels}ch: ${signal.alterations.join('; ')}`,
      );
      expect(signal.alterations).toEqual(alterations);
      expect(signal.kind).toBe(kind);
      expect(signal.isBitPerfect).toBe(kind === 'bit-perfect');
    });

    it('has no verdict before anything has been opened', async () => {
      const item = flac('signal-none', 440, 3, 1);
      const { player } = start([item], ['--ao=null'], { replayGainMode: 'off' });
      await wait(100);
      expect(player.state().signal.kind).toBeNull();
    });

    it('says ReplayGain changes the level only when it does', async () => {
      const item = flac('signal-rg', 440, 8, 1, { REPLAYGAIN_TRACK_GAIN: '-6 dB' });
      const { player, until } = start([item], ['--ao=null'], { replayGainMode: 'track', outputMode: 'exclusive' });
      player.play([1], 0);
      await until(({ signal }) => signal.alterations.includes('ReplayGain is changing the level'), 'the status');
      expect(player.state().signal.kind).toBe('adjusted');
      player.setReplayGainMode('off');
      await until(({ signal }) => signal.isBitPerfect, 'bit-perfect');
      expect(preampDb([])).toBe(0);
    });
  });
});
