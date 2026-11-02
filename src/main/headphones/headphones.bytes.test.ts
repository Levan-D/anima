/*
 * The predicted line and the level match against what mpv really writes, through the whole Player into the PCM writer. No device
 * and no sound. The measured curve is made up: what this proves is the EQ half, since nothing here can measure a real ear.
 */

import { statSync, writeFileSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EQ_AUTO_PREAMP, EQ_MAX_BANDS, type EqBand, type EqSettings } from '@shared/domain';
import { curveDb, effectivePreampDb } from '@shared/eqCurve';
import type { FrCurve } from '@shared/headphone';
import { MATCH_DEFAULTS } from '@shared/headphone';
import { matchedOff, measuredLine, predictedLine, valueAt } from '@shared/headphoneCurve';
import { matchBands } from '@shared/headphoneMatch';
import { ffmpeg, tempDir } from '@main/library/testFixtures';
import {
  decibels,
  fileTrack,
  finishedWriting,
  floatsOf,
  HAS_MPV,
  pcmArgs,
  rms,
  startRealPlayer,
} from '@main/playback/testAudio';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 });

const RATES = [44_100, 96_000];
const IMPULSE_AT = 64;
const IMPULSE_LEVEL = 0.25;
const SECONDS = 1.5;

function writeImpulse(path: string, rate: number): void {
  const frames = Math.round(rate * SECONDS);
  const data = Buffer.alloc(frames * 8);
  data.writeFloatLE(IMPULSE_LEVEL, IMPULSE_AT * 8);
  data.writeFloatLE(IMPULSE_LEVEL, IMPULSE_AT * 8 + 4);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 8, 28);
  header.writeUInt16LE(8, 32);
  header.writeUInt16LE(32, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
}

function spectrumDb(samples: Float32Array, rate: number, hz: number): number {
  const step = (2 * Math.PI * hz) / rate;
  let re = 0;
  let im = 0;
  for (let frame = 0; frame * 2 < samples.length; frame++) {
    const value = samples[frame * 2] ?? 0;
    if (value === 0) continue;
    re += value * Math.cos(step * frame);
    im -= value * Math.sin(step * frame);
  }
  return 20 * Math.log10(Math.hypot(re, im) / IMPULSE_LEVEL);
}

const BANDS: EqBand[] = [
  { id: 1, kind: 'lowshelf', frequencyHz: 105, gainDb: 5.5, q: 0.7 },
  { id: 2, kind: 'peak', frequencyHz: 180, gainDb: -2, q: 0.6 },
  { id: 3, kind: 'peak', frequencyHz: 2000, gainDb: 3.5, q: 1.3 },
  { id: 4, kind: 'peak', frequencyHz: 5700, gainDb: -7, q: 3.5 },
  { id: 5, kind: 'highshelf', frequencyHz: 10_000, gainDb: 2, q: 0.7 },
];

function madeUpResponse(): FrCurve {
  const hz = Array.from({ length: 500 }, (_, point) => 20 * 1000 ** (point / 499));
  const db = hz.map(
    (at) => 70 + 4 * Math.sin(Math.log2(at) * 1.5) + 10 * Math.exp(-((Math.log2(at / 3000) / 0.8) ** 2)),
  );
  return { hz, db };
}

describe.skipIf(!HAS_MPV)('the headphone lines against what mpv writes', () => {
  let dir: string;
  const notes: string[] = [];

  beforeAll(() => {
    dir = tempDir('headphones-bytes');
  });

  afterAll(() => {
    console.log(notes.join('\n'));
  });

  async function played(
    path: string,
    rate: number,
    durationMs: number,
    eq: EqSettings,
    name: string,
  ): Promise<Float32Array> {
    const item = fileTrack(1, path, {}, durationMs);
    const file = join(dir, `${name}.pcm`);
    const { player, until, stop } = startRealPlayer([item], pcmArgs(file, 'float'), { replayGainMode: 'off', eq });
    try {
      player.play([item.track.id], 0);
      await until(({ status }) => status === 'ended', 'the end of the queue');
      return floatsOf(await finishedWriting(file));
    } finally {
      stop();
    }
  }

  it.each(RATES)('predicted minus measured is what the filters do, at %i Hz', async (rate) => {
    const path = join(dir, `impulse-${rate}.wav`);
    writeImpulse(path, rate);
    const eq: EqSettings = { enabled: true, bands: BANDS, preamp: { auto: true, db: 0 } };
    const samples = await played(path, rate, SECONDS * 1000, eq, `predicted-${rate}`);

    const measured = measuredLine(madeUpResponse(), false);
    const predicted = predictedLine(measured, BANDS, rate);
    let worst = 0;
    for (let point = 0; point < predicted.hz.length; point += 8) {
      const hz = predicted.hz[point] ?? 0;
      if (hz < 40) continue;
      const realDb = spectrumDb(samples, rate, hz) - effectivePreampDb(eq);
      const drawn = (predicted.db[point] ?? 0) - (valueAt(measured, hz) ?? 0);
      worst = Math.max(worst, Math.abs(drawn - realDb));
    }
    notes.push(`Predicted against mpv at ${rate} Hz: worst ${worst.toFixed(6)} dB`);
    expect(worst).toBeLessThan(0.02);

    // So the method can tell: the same line drawn at the other rate is visibly off in the treble.
    const other = rate === 44_100 ? 96_000 : 44_100;
    const wrong = predictedLine(measured, BANDS, other);
    const at = 15_000;
    const realAt = spectrumDb(samples, rate, at) - effectivePreampDb(eq);
    expect(Math.abs((valueAt(wrong, at) ?? 0) - (valueAt(measured, at) ?? 0) - realAt)).toBeGreaterThan(0.1);
  });

  it.each(RATES)('a fitted EQ does what its curve says, at %i Hz', async (rate) => {
    const path = join(dir, `fit-impulse-${rate}.wav`);
    writeImpulse(path, rate);
    const made = madeUpResponse();
    const bands = matchBands({
      measurement: made,
      target: { hz: made.hz, db: made.hz.map(() => 70) },
      bassDb: 0,
      maxBands: EQ_MAX_BANDS,
      settings: MATCH_DEFAULTS,
    });
    const eq: EqSettings = { enabled: true, bands, preamp: EQ_AUTO_PREAMP };
    const samples = await played(path, rate, SECONDS * 1000, eq, `fit-${rate}`);
    let worst = 0;
    for (let hz = 40; hz < 20_000; hz *= 1.05) {
      const real = spectrumDb(samples, rate, hz) - effectivePreampDb(eq);
      worst = Math.max(worst, Math.abs(real - curveDb(bands, hz, rate)));
    }
    notes.push(`A fitted EQ against mpv at ${rate} Hz: worst ${worst.toFixed(6)} dB`);
    expect(worst).toBeLessThan(0.02);
  });

  describe('the matched off side', () => {
    const RATE = 44_100;
    const eq: EqSettings = { enabled: true, bands: BANDS, preamp: { auto: true, db: 0 } };

    it('applies exactly the computed gain and nothing else', async () => {
      const path = join(dir, 'tone.flac');
      ffmpeg(
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=700:duration=2:sample_rate=44100',
        '-af',
        'volume=0.25',
        '-ac',
        '2',
        '-sample_fmt',
        's16',
        path,
      );
      const flat: EqSettings = { enabled: false, bands: [], preamp: { auto: true, db: 0 } };
      const through = await played(path, RATE, 2000, flat, 'tone-through');
      const { eq: off, gainDb } = matchedOff(eq, RATE);
      const matched = await played(path, RATE, 2000, off, 'tone-matched');
      const measuredDb = decibels(rms(matched), rms(through));
      notes.push(`Matched off side: computed ${gainDb} dB, written ${measuredDb.toFixed(4)} dB`);
      expect(gainDb).toBeLessThan(-1);
      expect(measuredDb).toBeCloseTo(gainDb, 2);
    });

    it('is level with the EQ on pink noise, band-limited to the range it sums over', async () => {
      const path = join(dir, 'pink.flac');
      ffmpeg(
        '-f',
        'lavfi',
        '-i',
        'anoisesrc=color=pink:amplitude=0.25:duration=20:sample_rate=44100:seed=7',
        '-af',
        'highpass=f=100:poles=2,highpass=f=100:poles=2,lowpass=f=10000:poles=2,lowpass=f=10000:poles=2',
        '-ac',
        '2',
        '-c:a',
        'flac',
        '-sample_fmt',
        's32',
        path,
      );
      const { eq: off } = matchedOff(eq, RATE);
      const onSide = await played(path, RATE, 20_000, eq, 'pink-on');
      const offSide = await played(path, RATE, 20_000, off, 'pink-off');
      const apart = decibels(rms(onSide), rms(offSide));
      notes.push(`Pink noise, EQ on against matched off: ${apart.toFixed(3)} dB apart`);
      expect(Math.abs(apart)).toBeLessThan(0.3);
    });

    it('lands on the same gain when it happens during a file, as a hold does', async () => {
      const path = join(dir, 'long-tone.flac');
      ffmpeg(
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=700:duration=300:sample_rate=44100',
        '-af',
        'volume=0.25',
        '-ac',
        '2',
        '-sample_fmt',
        's16',
        path,
      );
      const item = fileTrack(1, path, {}, 300_000);
      const file = join(dir, 'live.pcm');
      const through = await played(
        path,
        RATE,
        300_000,
        { enabled: false, bands: [], preamp: { auto: true, db: 0 } },
        'live-through',
      );
      const reference = rms(through.subarray(through.length - RATE * 2));
      const { eq: off, gainDb } = matchedOff(eq, RATE);
      const { player, until, stop } = startRealPlayer([item], pcmArgs(file, 'float'), { replayGainMode: 'off', eq });
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
      const STRETCH_BYTES = RATE * 8 * 2;
      // The writer runs as fast as it can, so a stretch is let out while paused either side of each change.
      const letOut = async (): Promise<[number, number]> => {
        const start = await settled();
        player.resume();
        while (size() < start + STRETCH_BYTES) await new Promise((done) => setImmediate(done));
        player.pause();
        return [start, await settled()];
      };
      try {
        player.play([item.track.id], 0);
        player.pause();
        await until(({ status }) => status === 'paused', 'the file to load');
        const onBefore = await letOut();
        player.setEq(off);
        await wait(40);
        const offSide = await letOut();
        player.setEq(eq);
        await wait(40);
        const onAfter = await letOut();
        stop();
        const samples = floatsOf(await finishedWriting(file));
        const levelOf = ([start, to]: [number, number]) =>
          decibels(rms(samples.subarray(start / 4 + RATE / 2, to / 4)), reference);
        const expectedOn = effectivePreampDb(eq) + curveDb(BANDS, 700, RATE);
        notes.push(
          `A hold during a file: on ${levelOf(onBefore).toFixed(3)}, off ${levelOf(offSide).toFixed(3)} (computed ${gainDb}), on ${levelOf(onAfter).toFixed(3)} (curve ${expectedOn.toFixed(3)}) dB`,
        );
        expect(levelOf(onBefore)).toBeCloseTo(expectedOn, 1);
        expect(levelOf(offSide)).toBeCloseTo(gainDb, 1);
        expect(levelOf(onAfter)).toBeCloseTo(expectedOn, 1);
      } finally {
        stop();
      }
    });
  });
});
