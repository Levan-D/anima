/* A band at or above a file's Nyquist: what ffmpeg really does, through the Player, against the curve on screen. */

import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EqBand, EqBandKind } from '@shared/domain';
import { curveDb, isBandActive } from '@shared/eqCurve';
import { tempDir } from '@main/library/testFixtures';
import {
  decibels,
  decodeAlone,
  fileTrack,
  finishedWriting,
  floatsOf,
  HAS_MPV,
  makeStereoTone,
  pcmArgs,
  rms,
  startRealPlayer,
  type FileTrack,
  type RealPlayer,
} from './testAudio';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const PREAMP = { auto: false, db: 0 };
const TOLERANCE_DB = 0.02;
const KINDS: EqBandKind[] = ['peak', 'lowshelf', 'highshelf'];

describe.skipIf(!HAS_MPV)('a band at or above Nyquist', () => {
  let dir: string;
  let running: RealPlayer | null = null;

  afterEach(() => {
    running?.stop();
    running = null;
  });

  beforeAll(() => {
    dir = tempDir('player-nyquist');
  });

  function toneAt(rate: number, frequency = 3000): FileTrack {
    const path = join(dir, `tone-${rate}-${frequency}.flac`);
    makeStereoTone(path, { frequency, seconds: 5, rate });
    return fileTrack(rate + frequency, path, {}, 5000);
  }

  async function measuredDb(item: FileTrack, band: EqBand): Promise<{ db: number; frames: number; hasBad: boolean }> {
    const file = join(dir, `out-${item.track.id}-${band.kind}-${band.frequencyHz}.pcm`);
    running = startRealPlayer([item], pcmArgs(file, 'float'), {
      replayGainMode: 'off',
      eq: { enabled: true, bands: [band], preamp: PREAMP },
    });
    running.player.play([item.track.id], 0);
    await running.until(({ status }) => status === 'ended', 'the end of the queue');
    expect(running.notices).toEqual([]);
    const samples = floatsOf(await finishedWriting(file));
    running.stop();
    running = null;
    return {
      db: decibels(rms(samples), rms(floatsOf(decodeAlone(item.path, 'float')))),
      frames: samples.length / 2,
      hasBad: samples.some((sample) => !Number.isFinite(sample)),
    };
  }

  const cases: [string, number, number][] = [
    ['20 kHz on a 32 kHz file', 32_000, 20_000],
    ['16 kHz on a 22.05 kHz file', 22_050, 16_000],
    ['12 kHz on a 22.05 kHz file, the default top band', 22_050, 12_000],
    ['6 kHz on an 11.025 kHz file', 11_025, 6_000],
  ];

  it.each(cases)('passes through %s, and the curve says so', async (_name, rate, frequencyHz) => {
    const item = toneAt(rate);
    for (const kind of KINDS) {
      const band: EqBand = { id: 1, kind, frequencyHz, gainDb: 6, q: 1 };
      expect(isBandActive(band, rate)).toBe(false);
      const { db, frames, hasBad } = await measuredDb(item, band);
      expect(hasBad).toBe(false);
      expect(frames).toBe(5 * rate);
      expect(Math.abs(db)).toBeLessThan(TOLERANCE_DB);
      expect(curveDb([band], 3000, rate)).toBe(0);
    }
  });

  it.each(KINDS)('runs a %s exactly on Nyquist, as the curve says', async (kind) => {
    const item = toneAt(32_000);
    const band: EqBand = { id: 1, kind, frequencyHz: 16_000, gainDb: 6, q: 1 };
    expect(isBandActive(band, 32_000)).toBe(true);
    const { db, hasBad } = await measuredDb(item, band);
    expect(hasBad).toBe(false);
    expect(Math.abs(db - curveDb([band], 3000, 32_000))).toBeLessThan(TOLERANCE_DB);
  });

  it.each(KINDS)('runs a %s just under Nyquist, as the curve says', async (kind) => {
    const item = toneAt(32_000);
    const band: EqBand = { id: 1, kind, frequencyHz: 15_000, gainDb: 6, q: 1 };
    const { db } = await measuredDb(item, band);
    expect(Math.abs(db - curveDb([band], 3000, 32_000))).toBeLessThan(TOLERANCE_DB);
  });
});
