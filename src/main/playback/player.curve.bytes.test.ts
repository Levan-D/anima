/*
 * The curve on screen against mpv's actual output: an impulse through the whole Player into the PCM writer, and its
 * spectrum against `curveDb`, at each rate. mpv filters at the file's own rate, so this is where the bilinear transform
 * shows. No device is involved.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EQ_AUTO_PREAMP, type EqBand, type EqBandKind, type EqPreamp } from '@shared/domain';
import { curveDb, effectivePreampDb } from '@shared/eqCurve';
import { tempDir } from '@main/library/testFixtures';
import { fileTrack, finishedWriting, floatsOf, HAS_MPV, pcmArgs, startRealPlayer, type FileTrack } from './testAudio';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 60_000 });

const RATES = [44_100, 48_000, 96_000, 192_000];
const IMPULSE_AT = 64;
const IMPULSE_LEVEL = 0.25;
const SECONDS = 1.5;
const LOWEST_HZ = 40;
const POINTS = 60;

/** Stereo 32-bit float, so it decodes to exactly what's written. */
function writeImpulse(path: string, rate: number, seconds: number): void {
  const frames = Math.round(rate * seconds);
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

/** The left channel's level at one frequency, relative to the impulse put in. */
function levelDb(samples: Float32Array, rate: number, hz: number): number {
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

function gridUpTo(top: number): number[] {
  return Array.from({ length: POINTS }, (_, point) => LOWEST_HZ * (top / LOWEST_HZ) ** (point / (POINTS - 1)));
}

const band = (kind: EqBandKind, frequencyHz: number, gainDb: number, q: number, id = 1): EqBand => ({
  id,
  kind,
  frequencyHz,
  gainDb,
  q,
});

describe.skipIf(!HAS_MPV)('the curve on screen against what mpv writes', () => {
  let dir: string;
  const impulses = new Map<number, FileTrack>();
  const worstSeen: string[] = [];

  beforeAll(() => {
    dir = tempDir('player-curve-bytes');
    for (const rate of RATES) {
      const path = join(dir, `impulse-${rate}.wav`);
      writeImpulse(path, rate, SECONDS);
      impulses.set(rate, fileTrack(rate, path, {}, SECONDS * 1000));
    }
  });

  afterAll(() => {
    console.log(worstSeen.join('\n'));
  });

  async function worstAgainstCurve(
    rate: number,
    bands: EqBand[],
    preamp: EqPreamp = EQ_AUTO_PREAMP,
    name: string = bands.map(({ kind, q, gainDb }) => `${kind} Q${q} ${gainDb} dB`).join(', '),
  ): Promise<number> {
    const item = impulses.get(rate);
    if (item === undefined) throw new Error(`No impulse at ${rate}`);
    const file = join(dir, `out-${rate}-${worstSeen.length}.pcm`);
    const { player, until, stop } = startRealPlayer([item], pcmArgs(file, 'float'), {
      replayGainMode: 'off',
      eq: { enabled: true, bands, preamp },
    });
    try {
      player.play([item.track.id], 0);
      await until(({ status }) => status === 'ended', 'the end of the queue');
      const samples = floatsOf(await finishedWriting(file));
      const applied = effectivePreampDb({ bands, preamp });
      let worst = 0;
      for (const hz of gridUpTo(Math.min(rate / 2 - 100, 40_000))) {
        const error = Math.abs(levelDb(samples, rate, hz) - applied - curveDb(bands, hz, rate));
        worst = Math.max(worst, error);
      }
      worstSeen.push(`${rate} Hz, ${name}: worst ${worst.toFixed(4)} dB`);
      return worst;
    } finally {
      stop();
    }
  }

  const SHAPES: EqBand[] = [];
  for (const q of [0.5, 1.41, 4]) {
    for (const gainDb of [6, -9]) {
      SHAPES.push(band('peak', 1000, gainDb, q), band('peak', 15_000, gainDb, q));
    }
  }
  for (const q of [0.4, 0.707, 1.4]) {
    for (const gainDb of [6, -9]) {
      SHAPES.push(band('lowshelf', 105, gainDb, q), band('highshelf', 10_000, gainDb, q));
    }
  }

  // ffmpeg's filters run in 32-bit float, which is what's left at the bottom of 192 kHz: with its precision=f64 it was 0.0000 dB.
  const allowedDb = (rate: number) => (rate === 192_000 ? 0.1 : 0.05);

  it.each(RATES)('matches every kind of band at several Q, at %i Hz', async (rate) => {
    for (const shape of SHAPES) expect(await worstAgainstCurve(rate, [shape])).toBeLessThan(allowedDb(rate));
  });

  it.each(RATES)('matches ten bands together, at %i Hz', async (rate) => {
    const preset = [
      band('lowshelf', 105, 6.5, 0.7, 1),
      band('peak', 7899, 6.5, 0.68, 2),
      band('peak', 178, -3.2, 0.49, 3),
      band('peak', 5470, -7.3, 4.4, 4),
      band('peak', 1222, -2.3, 2.34, 5),
      band('highshelf', 10_000, -1.1, 0.7, 6),
      band('peak', 2250, 1.3, 3.58, 7),
      band('peak', 3380, -0.9, 2.84, 8),
      band('peak', 6701, 1.2, 6, 9),
      band('peak', 784, -0.4, 3.52, 10),
    ];
    expect(await worstAgainstCurve(rate, preset, EQ_AUTO_PREAMP, 'HD 660 S preset')).toBeLessThan(0.05);
    expect(await worstAgainstCurve(rate, preset, { auto: false, db: -3 }, 'HD 660 S preset, -3 by hand')).toBeLessThan(
      0.05,
    );
  });

  it('would notice the wrong rate: 44.1 kHz’s curve is well off a 96 kHz file', () => {
    const bands = [band('peak', 15_000, 6, 1.41)];
    expect(Math.abs(curveDb(bands, 19_000, 44_100) - curveDb(bands, 19_000, 96_000))).toBeGreaterThan(0.5);
  });
});
