/*
 * The audit's real files, read-only from the library, through the whole Player. Silent: the output is mpv's PCM writer, into
 * .dev. Skipped unless MUSIC_PLAYER_REAL_LIBRARY names the folder, and it needs a copy of the real database, as
 * player.realFiles.test.ts does:
 *
 *   MUSIC_PLAYER_REAL_LIBRARY='D:\Music' npx vitest run src/main/playback/player.audit.realFiles.test.ts --silent=false
 */

import { createHash } from 'node:crypto';
import { existsSync, openSync, readSync, closeSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EQ_AUTO_PREAMP, type EqBand, type EqSettings } from '@shared/domain';
import { connect } from '@main/db/connection';
import { libraryPaths } from '@main/library/dataDir';
import { tempDir } from '@main/library/testFixtures';
import { chainFor, chainSpec } from './eqChain';
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
  type FileTrack,
  type RealPlayer,
} from './testAudio';

vi.setConfig({ testTimeout: 590_000 });

const FOLDER = process.env.MUSIC_PLAYER_REAL_LIBRARY ?? '';
const DATABASE = libraryPaths(FOLDER, join('.dev', 'real', 'player', 'data')).dbPath;
const ALBUM = ['Nightwish', 'Human II Nature', 'Human'];
// The format allows an encoder to leave its MD5 out, and some of this library's did.
const NO_MD5 = '0'.repeat(32);
const HD660: EqBand[] = [
  { id: 1, kind: 'lowshelf', frequencyHz: 105, gainDb: 6.5, q: 0.7 },
  { id: 2, kind: 'peak', frequencyHz: 7899, gainDb: 6.5, q: 0.68 },
  { id: 3, kind: 'peak', frequencyHz: 5470, gainDb: -7.3, q: 4.4 },
  { id: 4, kind: 'highshelf', frequencyHz: 10_000, gainDb: -1.1, q: 0.7 },
];
const EQ: EqSettings = { enabled: true, bands: HD660, preamp: EQ_AUTO_PREAMP };

type Row = { p: string; rate: number; bits: number | null; codec: string; hash: string | null; durationMs: number };

function rows(where: string, limit: number): Row[] {
  const db = connect(DATABASE);
  try {
    return db
      .prepare<[number], Row>(
        `SELECT rel_path AS p, sample_rate AS rate, bit_depth AS bits, codec, audio_hash AS hash, duration_ms AS durationMs
         FROM files WHERE ${where} ORDER BY rel_path LIMIT ?`,
      )
      .all(limit);
  } finally {
    db.close();
  }
}

const atFolder = (relPath: string) => join(FOLDER, relPath);

function flacStreamInfoMd5(path: string): string {
  const handle = openSync(path, 'r');
  try {
    // The stream marker and the metadata block header, then STREAMINFO with its MD5 as the last 16 of 34 bytes.
    const buffer = Buffer.alloc(4 + 4 + 34);
    readSync(handle, buffer, 0, buffer.length, 0);
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('fLaC');
    return buffer.subarray(4 + 4 + 18, 4 + 4 + 34).toString('hex');
  } finally {
    closeSync(handle);
  }
}

/** Two tracks in a row from a folder holding at least two files like this. */
function albumPairs(where: string, count: number): Row[][] {
  const all = rows(where, 3000);
  const byFolder = Map.groupBy(all, ({ p }) => p.slice(0, p.lastIndexOf('/')));
  const albums = [...byFolder.values()].filter((files) => files.length >= 2);
  const spread = Math.max(1, Math.floor(albums.length / count));
  return albums
    .filter((_, index) => index % spread === 0)
    .slice(0, count)
    .map((files) => files.slice(0, 2));
}

describe.skipIf(!FOLDER || !HAS_MPV || !existsSync(DATABASE))('the audit, on the real library', () => {
  let running: RealPlayer | null = null;

  afterEach(() => {
    running?.stop();
    running = null;
  });

  async function playAll(
    tracks: FileTrack[],
    file: string,
    format: 's32' | 'float',
    settings = {},
    extra: string[] = [],
  ) {
    running = startRealPlayer(tracks, pcmArgs(file, format, extra), { replayGainMode: 'off', ...settings });
    running.player.play(
      tracks.map(({ track }) => track.id),
      0,
    );
    await running.until(({ status }) => status === 'ended', 'the end of the queue', 500_000);
    expect(running.notices).toEqual([]);
    const output = await finishedWriting(file);
    running.stop();
    running = null;
    return output;
  }

  const before = (paths: string[]) => paths.map((path) => statSync(path).mtimeMs);

  it('plays 16-bit FLACs to the MD5 their encoder wrote, which no decoder here had a hand in', async () => {
    const dir = tempDir('audit-md5');
    const chosen = rows(
      "codec = 'FLAC' AND bit_depth = 16 AND sample_rate = 44100 AND duration_ms < 300000 AND id % 80 = 7",
      12,
    );
    let matched = 0;
    for (const { p } of chosen) {
      const path = atFolder(p);
      const stated = flacStreamInfoMd5(path);
      if (stated === NO_MD5) continue;
      matched++;
      const output = await playAll([fileTrack(1, path)], join(dir, 'out.pcm'), 's32', {}, ['--audio-format=s16']);
      const heard = createHash('md5').update(output).digest('hex');
      console.log(`MD5 16-bit: ${heard === stated ? 'match' : `DIFFERENT, ${stated} vs ${heard}`}`);
      expect(heard).toBe(stated);
    }
    console.log(`MD5 16-bit: ${matched} of ${chosen.length} had one, and all matched`);
    expect(matched).toBeGreaterThan(3);
    rmSync(dir, { recursive: true, force: true });
  });

  it('plays 24-bit FLACs to their MD5 too, through s32 with the low byte dropped', async () => {
    const dir = tempDir('audit-md5-24');
    const chosen = rows("codec = 'FLAC' AND bit_depth = 24 AND duration_ms < 200000 AND id % 40 = 1", 12);
    let matched = 0;
    for (const { p, rate } of chosen) {
      const path = atFolder(p);
      const stated = flacStreamInfoMd5(path);
      if (stated === NO_MD5) continue;
      matched++;
      const output = await playAll([fileTrack(1, path)], join(dir, 'out.pcm'), 's32');
      // What the MD5 is of: little-endian 24-bit. mpv's s32 holds them in the top three bytes.
      const packed = Buffer.alloc((output.length / 4) * 3);
      let lowBytes = 0;
      for (let at = 0, to = 0; at < output.length; at += 4, to += 3) {
        lowBytes |= output[at] ?? 0;
        packed[to] = output[at + 1] ?? 0;
        packed[to + 1] = output[at + 2] ?? 0;
        packed[to + 2] = output[at + 3] ?? 0;
      }
      const heard = createHash('md5').update(packed).digest('hex');
      console.log(
        `MD5 24-bit at ${rate}: ${heard === stated ? 'match' : 'DIFFERENT'}, low byte unused: ${lowBytes === 0}`,
      );
      expect(heard).toBe(stated);
      expect(lowBytes).toBe(0);
    }
    console.log(`MD5 24-bit: ${matched} of ${chosen.length} had one, and all matched`);
    expect(matched).toBeGreaterThan(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('is gapless with EQ on from Music into Noise, each filtered as if alone', async () => {
    const dir = tempDir('audit-human');
    const paths = ['Music.flac', 'Noise.flac'].map((name) => join(FOLDER, ...ALBUM, name));
    const stamps = before(paths);
    const tracks = paths.map((path, index) => fileTrack(index + 1, path));
    const output = await playAll(tracks, join(dir, 'eq.pcm'), 'float', { eq: EQ });
    const args = [`--af=${chainSpec(chainFor(EQ))}`];
    const alone = paths.map((path) => decodeAlone(path, 'float', args));
    expect(firstDifference(output, Buffer.concat(alone))).toBeNull();
    console.log(`Human with EQ: ${output.length / 8} frames, identical`);
    expect(before(paths)).toEqual(stamps);
    rmSync(dir, { recursive: true, force: true });
  });

  it('holds byte for byte between real tracks, at each format the library has', async () => {
    const dir = tempDir('audit-pairs');
    const groups: [string, string, 's32' | 'float'][] = [
      ['FLAC 16/44.1', "codec = 'FLAC' AND bit_depth = 16 AND sample_rate = 44100 AND duration_ms < 240000", 's32'],
      ['FLAC 24/44.1', "codec = 'FLAC' AND bit_depth = 24 AND sample_rate = 44100 AND duration_ms < 240000", 's32'],
      ['FLAC 24/96', "codec = 'FLAC' AND sample_rate = 96000 AND duration_ms < 200000", 's32'],
      ['FLAC 24/192', "codec = 'FLAC' AND sample_rate = 192000 AND duration_ms < 200000", 's32'],
      ['MP3', "codec = 'MP3' AND duration_ms < 240000", 'float'],
    ];
    for (const [name, where, format] of groups) {
      for (const pair of albumPairs(where, 3)) {
        const paths = pair.map(({ p }) => atFolder(p));
        const output = await playAll(
          paths.map((path, index) => fileTrack(index + 1, path)),
          join(dir, 'out.pcm'),
          format,
        );
        const alone = paths.map((path) => decodeAlone(path, format));
        const same = firstDifference(output, Buffer.concat(alone));
        console.log(`Pair ${name}: ${output.length} bytes, ${same === null ? 'identical' : `differs at ${same.at}`}`);
        expect(same).toBeNull();
      }
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('counts the MP3s with a header that says their delay and padding, which gapless needs', () => {
    const mp3s = rows("codec = 'MP3'", 2000);
    const counts = { total: mp3s.length, lame: 0, xingOnly: 0, none: 0 };
    for (const { p } of mp3s) {
      const handle = openSync(atFolder(p), 'r');
      try {
        // Past any ID3v2 tag, whose size is at its start, to the first frame's Xing or Info header.
        const head = Buffer.alloc(10);
        readSync(handle, head, 0, 10, 0);
        const isTagged = head.subarray(0, 3).toString('latin1') === 'ID3';
        const tagSize = isTagged
          ? 10 + (((head[6] ?? 0) << 21) | ((head[7] ?? 0) << 14) | ((head[8] ?? 0) << 7) | (head[9] ?? 0))
          : 0;
        const frame = Buffer.alloc(2048);
        readSync(handle, frame, 0, frame.length, tagSize);
        const text = frame.toString('latin1');
        const hasXing = text.includes('Xing') || text.includes('Info');
        const hasLame = /LAME|Lavf|Lavc/.test(text);
        if (hasXing && hasLame) counts.lame++;
        else if (hasXing) counts.xingOnly++;
        else counts.none++;
      } finally {
        closeSync(handle);
      }
    }
    console.log(`MP3 headers: ${JSON.stringify(counts)}`);
    expect(counts.total).toBeGreaterThan(0);
  });

  it('matches ReplayGain tags on real tracks: Track and Album, against the tag and its peak', async () => {
    const dir = tempDir('audit-gain');
    const SAMPLE = rows('id % 90 = 5 AND duration_ms > 40000', 60);
    const tally = { checked: 0, untagged: 0, cutShortByPeak: 0, worst: 0 };
    for (const { p } of SAMPLE) {
      const path = atFolder(p);
      const item = fileTrack(1, path, { startMs: 20_000, endMs: 30_000 }, 10_000);
      const render = async (mode: 'off' | 'track' | 'album') => {
        const file = join(dir, `${mode}.pcm`);
        running = startRealPlayer([item], pcmArgs(file, 'float'), { replayGainMode: mode });
        const { player, until, ask, stop } = running;
        player.play([1], 0);
        await until(({ signal }) => signal.output !== null, 'the output', 30_000);
        const tags = (await ask('current-tracks/audio')) as Record<string, number | undefined> | null;
        await until(({ status }) => status === 'ended', 'the end', 60_000);
        const samples = floatsOf(await finishedWriting(file));
        stop();
        running = null;
        return { tags, level: rms(samples) };
      };
      const off = await render('off');
      const tags = off.tags ?? {};
      const trackGain = tags['replaygain-track-gain'];
      if (trackGain === undefined) tally.untagged++;
      for (const mode of ['track', 'album'] as const) {
        const { level } = await render(mode);
        const measured = decibels(level, off.level);
        const gain = tags[`replaygain-${mode}-gain`] ?? 0;
        const peak = tags[`replaygain-${mode}-peak`] ?? 1;
        const expected = Math.min(gain, -20 * Math.log10(peak));
        if (expected < gain) tally.cutShortByPeak++;
        tally.checked++;
        tally.worst = Math.max(tally.worst, Math.abs(measured - expected));
        expect(Math.abs(measured - expected), `${mode} on a tagged ${gain} peak ${peak}`).toBeLessThan(0.02);
      }
    }
    console.log(`ReplayGain real files: ${JSON.stringify(tally)}`);
    rmSync(dir, { recursive: true, force: true });
  });
});
