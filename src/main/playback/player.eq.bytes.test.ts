/* The EQ measured in what mpv writes, the method of player.bytes.test.ts. Generated tones, the PCM writer, no device. */

import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { EQ_AUTO_PREAMP, type EqBand, type EqSettings } from '@shared/domain';
import { curveDb, preampDb } from '@shared/eqCurve';
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
  makeStereoTone,
  MPV_PATH,
  pcmArgs,
  rms,
  startRealPlayer,
  type FileTrack,
  type RealPlayer,
} from './testAudio';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

const PEAK: EqBand = { id: 1, kind: 'peak', frequencyHz: 1000, gainDb: 6, q: 1 };
const on = (...bands: EqBand[]): EqSettings => ({ enabled: true, bands, preamp: EQ_AUTO_PREAMP });
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
const LEVEL_TOLERANCE_DB = 0.05;
const STRETCH_BYTES = 3 * 44_100 * 2 * 4;

function samplesOfS16(bytes: Buffer): Float32Array {
  const samples = new Float32Array(Math.floor(bytes.length / 2));
  for (let at = 0; at < samples.length; at++) samples[at] = bytes.readInt16LE(at * 2) / 32_768;
  return samples;
}

function decodeAloneS16(input: string, args: string[]): Buffer {
  const output = join(tempDir('decode-s16'), 'alone.pcm');
  const result = spawnSync(
    MPV_PATH,
    [
      '--no-config',
      '--vid=no',
      '--replaygain=no',
      '--ao=pcm',
      `--ao-pcm-file=${output}`,
      '--ao-pcm-waveheader=no',
      '--audio-format=s16',
      ...args,
      input,
    ],
    { stdio: 'ignore', windowsHide: true },
  );
  if (result.status !== 0) throw new Error(`Decoding ${input} failed with ${result.status}`);
  return readFileSync(output);
}

describe.skipIf(!HAS_MPV)('the EQ in bytes', () => {
  let dir: string;
  let running: RealPlayer | null = null;

  const start = (...args: Parameters<typeof startRealPlayer>) => {
    running = startRealPlayer(...args);
    return running;
  };

  function tone(name: string, frequency: number, seconds: number, volume?: number): FileTrack {
    const path = join(dir, `${name}.flac`);
    makeStereoTone(path, { frequency, seconds, ...(volume === undefined ? {} : { volume }) });
    return fileTrack(frequency + seconds, path, {}, seconds * 1000);
  }

  beforeAll(() => {
    dir = tempDir('player-eq-bytes');
  });

  afterEach(() => {
    running?.stop();
    running = null;
  });

  it('leaves the audio byte-identical when off, and when on but flat', async () => {
    const item = tone('untouched', 440, 20);
    const expected = decodeAlone(item.path, 's32');

    const settings: [string, EqSettings][] = [
      ['off', { enabled: false, bands: [PEAK], preamp: EQ_AUTO_PREAMP }],
      ['flat', on({ ...PEAK, gainDb: 0 })],
    ];
    for (const [name, eq] of settings) {
      const file = join(dir, `${name}.pcm`);
      const { player, until, stop, sent } = startRealPlayer([item], pcmArgs(file, 's32'), {
        replayGainMode: 'off',
        eq,
      });
      try {
        player.play([item.track.id], 0);
        await until(({ status }) => status === 'ended', 'the end of the queue');
        expect(firstDifference(await finishedWriting(file), expected)).toBeNull();
        expect(sent().filter(([command]) => command === 'af')).toEqual([]);
      } finally {
        stop();
      }
    }
  });

  it('clears to byte-identical after being on', async () => {
    const item = tone('cleared', 440, 20);
    const file = join(dir, 'cleared.pcm');
    const { player, until, sent } = start([item], pcmArgs(file, 's32'), { replayGainMode: 'off', eq: on(PEAK) });
    await wait(100);
    player.setEq({ enabled: false, bands: [PEAK], preamp: EQ_AUTO_PREAMP });
    await wait(100);
    expect(
      sent()
        .filter(([command]) => command === 'af')
        .map(([, operation]) => operation),
    ).toEqual(['set', 'clr']);
    player.play([item.track.id], 0);
    await until(({ status }) => status === 'ended', 'the end of the queue');
    expect(firstDifference(await finishedWriting(file), decodeAlone(item.path, 's32'))).toBeNull();
  });

  const SHAPES: [string, number, EqBand[]][] = [
    ['a +6 dB peak at its frequency, the preamp taking it back', 1000, [PEAK]],
    ['a +6 dB peak far from its frequency, where only the preamp shows', 60, [PEAK]],
    ['a -6 dB peak at its frequency', 1000, [{ ...PEAK, gainDb: -6 }]],
    ['a +6 dB low shelf well inside it', 40, [{ ...PEAK, kind: 'lowshelf', frequencyHz: 400, q: 0.707 }]],
    ['a +6 dB low shelf well above it', 5000, [{ ...PEAK, kind: 'lowshelf', frequencyHz: 200, q: 0.707 }]],
    ['a +6 dB high shelf well inside it', 18_000, [{ ...PEAK, kind: 'highshelf', frequencyHz: 4000, q: 0.707 }]],
    ['a +6 dB high shelf at its corner', 4000, [{ ...PEAK, kind: 'highshelf', frequencyHz: 4000, q: 0.707 }]],
    [
      'three bands together',
      800,
      [
        { ...PEAK, frequencyHz: 800, gainDb: 4, q: 2 },
        { ...PEAK, id: 2, kind: 'lowshelf', frequencyHz: 120, gainDb: 3, q: 0.7 },
        { ...PEAK, id: 3, kind: 'highshelf', frequencyHz: 8000, gainDb: -5, q: 0.7 },
      ],
    ],
  ];

  it.each(SHAPES)('measures what the curve says for %s', async (name, frequency, bands) => {
    const item = tone(`shape-${SHAPES.findIndex(([other]) => other === name)}`, frequency, 10);
    const file = join(dir, `shape-${frequency}-${bands.length}-${bands[0]?.kind}-${bands[0]?.gainDb}.pcm`);
    const { player, until } = start([item], pcmArgs(file, 'float'), { replayGainMode: 'off', eq: on(...bands) });
    player.play([item.track.id], 0);
    await until(({ status }) => status === 'ended', 'the end of the queue');

    const reference = rms(floatsOf(decodeAlone(item.path, 'float')));
    const measured = decibels(rms(floatsOf(await finishedWriting(file))), reference);
    const expected = curveDb(bands, frequency, 44_100) + preampDb(bands);
    expect(Math.abs(measured - expected)).toBeLessThan(LEVEL_TOLERANCE_DB);
  });

  it('never goes over full scale, on a tone at full scale with a big boost', async () => {
    const item = tone('loud', 1000, 10, 7.9);
    const file = join(dir, 'loud.pcm');
    const { player, until } = start([item], pcmArgs(file, 'float'), {
      replayGainMode: 'off',
      eq: on({ ...PEAK, gainDb: 12 }),
    });
    player.play([item.track.id], 0);
    await until(({ status }) => status === 'ended', 'the end of the queue');
    const samples = floatsOf(await finishedWriting(file));
    const peak = samples.reduce((highest, sample) => Math.max(highest, Math.abs(sample)), 0);
    // Stereo from mono comes down 3 dB, so this tone peaks at about 0.7. Unattenuated, it would reach 2.8.
    expect(peak).toBeGreaterThan(0.6);
    expect(peak).toBeLessThanOrEqual(1);
  });

  /** A chain with a boost then the same cut, so in float it comes out as it went in, and anywhere else it clips between them. */
  const BOOST_THEN_CUT: EqBand[] = [
    { ...PEAK, gainDb: 12 },
    { ...PEAK, id: 2, gainDb: -12 },
  ];

  it('never runs in integers, even on a 16-bit file going out as 16-bit', async () => {
    const item = tone('in-float', 1000, 5, 7.9);
    const file = join(dir, 'in-float.pcm');
    const { player, until } = start([item], pcmArgs(file, 'float', ['--audio-format=s16']), {
      replayGainMode: 'off',
      eq: { enabled: true, bands: BOOST_THEN_CUT, preamp: { auto: false, db: 0 } },
    });
    player.play([item.track.id], 0);
    await until(({ status }) => status === 'ended', 'the end of the queue');
    const samples = samplesOfS16(await finishedWriting(file));
    const reference = samplesOfS16(decodeAloneS16(item.path, []));
    expect(Math.abs(decibels(rms(samples), rms(reference)))).toBeLessThan(0.01);
  });

  // The control: what the chain's volume and its r=f64 are keeping out.
  it('clips inside the chain in plain biquads with no volume, so it can tell', () => {
    const item = tone('in-s16', 1000, 5, 7.9);
    const reference = samplesOfS16(decodeAloneS16(item.path, []));
    const chain = chainSpec({ preampDb: 0, bands: BOOST_THEN_CUT })
      .split(',')
      .slice(1)
      .join(',')
      .replaceAll(':r=f64', '');
    const samples = samplesOfS16(decodeAloneS16(item.path, [`--af=${chain}`]));
    expect(Math.abs(decibels(rms(samples), rms(reference)))).toBeGreaterThan(1);
  });

  it('stays gapless across a boundary: no sample lost or added, and each file as it would be alone', async () => {
    // Whole cycles in each file, so the tone runs on across the boundary with no step of its own.
    const first = tone('gapless-a', 1000, 30);
    const second = { ...tone('gapless-b', 1000, 31), track: { ...first.track, id: 2 } };
    const eq = on({ ...PEAK, gainDb: 6 });
    const file = join(dir, 'gapless-eq.pcm');
    const { player, until, sent, notices } = start([first, second], pcmArgs(file, 'float'), {
      replayGainMode: 'off',
      eq,
    });
    player.play([first.track.id, 2], 0);
    await until(({ status }) => status === 'ended', 'the end of the queue');
    expect(notices).toEqual([]);
    expect(
      sent()
        .filter(([command]) => command === 'loadfile')
        .map(([, , mode]) => mode),
    ).toEqual(['replace', 'append']);

    const output = await finishedWriting(file);
    expect(output.length).toBe((30 + 31) * 44_100 * 2 * 4);

    const args = [`--af=${chainSpec(chainFor(eq))}`];
    const expected = Buffer.concat([decodeAlone(first.path, 'float', args), decodeAlone(second.path, 'float', args)]);
    expect(firstDifference(output, expected)).toBeNull();

    // What a boundary costs: mpv starts the filters again there, so a filter holding a tone of its own frequency restarts.
    const samples = floatsOf(output);
    const boundary = 30 * 44_100 * 2;
    const stepAround = (from: number, to: number) => {
      let largest = 0;
      for (let at = from; at < to; at += 2)
        largest = Math.max(largest, Math.abs((samples[at + 2] ?? 0) - (samples[at] ?? 0)));
      return largest;
    };
    const normal = stepAround(boundary - 88_200, boundary - 4_410);
    const atBoundary = stepAround(boundary - 4_410, boundary + 4_410);
    expect(atBoundary).toBeLessThan(normal * 3);
  });

  it('moves a value without touching the stream, and keeps it through a set, a seek and a new file', async () => {
    const item = tone('moving', 1000, 500);
    const following = { ...tone('moving-next', 1000, 400), track: { ...item.track, id: 2 } };
    const file = join(dir, 'moving.pcm');
    const eq = on({ ...PEAK, gainDb: 6 });
    const { player, until, sent, ask } = start([item, following], pcmArgs(file, 'float'), {
      replayGainMode: 'off',
      eq,
    });
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
    const stretches: { name: string; from: number; to: number }[] = [];
    const letOut = async (name: string) => {
      const from = await sizeOnceSettled();
      player.resume();
      while (size() < from + STRETCH_BYTES) await new Promise((done) => setImmediate(done));
      player.pause();
      const to = await sizeOnceSettled();
      expect(to).toBeGreaterThan(from);
      stretches.push({ name, from, to });
    };

    await wait(50);
    player.play([item.track.id, 2], 0);
    player.pause();
    await until(({ status }) => status === 'paused', 'the file to load');

    await letOut('as set');
    const setsBefore = sent().filter(([command]) => command === 'af').length;

    // Through the headroom too: 6 down to 3 takes the band and the preamp with it, so this hears only the band's -3...
    player.setEq(on({ ...PEAK, gainDb: 3 }));
    await wait(40);
    expect(sent().filter(([command]) => command === 'af')).toHaveLength(setsBefore);
    expect(
      sent()
        .filter(([command]) => command === 'af-command')
        .map(([, , what]) => what),
    ).toEqual(['gain', 'volume']);
    await letOut('commanded');

    // ...and nothing was lost or reopened: the writer truncates when its output opens.
    const position = await ask('time-pos');
    const framesWritten = size() / 8;
    expect(Math.abs(framesWritten - Number(position) * 44_100)).toBeLessThan(44_100 * 0.5);

    await wait(400);
    expect(sent().filter(([command]) => command === 'af')).toHaveLength(setsBefore + 1);
    await letOut('set');

    player.seek(60_000);
    await wait(50);
    await letOut('after a seek');

    player.playQueueIndex(1);
    player.pause();
    await until(({ status }) => status === 'paused', 'the next file');
    await letOut('on the next file');

    const samples = floatsOf(readFileSync(file));

    // No restart at the command or at the set, which on this tone would be a step of up to 10 times its own. The level does
    // jump 3 dB in one go here, which is a step of its own and a bigger one than a drag ever takes.
    const seekAt = Math.floor((stretches[3]?.from ?? 0) / 4);
    const stepWithin = (from: number, to: number) => {
      let largest = 0;
      for (let at = from; at < to; at += 2)
        largest = Math.max(largest, Math.abs((samples[at + 2] ?? 0) - (samples[at] ?? 0)));
      return largest;
    };
    expect(stepWithin(44_100, seekAt - 4)).toBeLessThan(stepWithin(44_100, 88_200) * 3);

    const level = ({ from, to }: { from: number; to: number }) => {
      const start = Math.floor(from / 4);
      const end = Math.floor(to / 4);
      return rms(samples.subarray(start + Math.floor((end - start) * 0.3), end - Math.floor((end - start) * 0.1)));
    };
    const reference = rms(floatsOf(decodeAlone(tone('moving-reference', 1000, 5).path, 'float')));
    const measured = stretches.map((stretch) => ({ name: stretch.name, db: decibels(level(stretch), reference) }));
    // Whatever the gain, Auto puts a 1 kHz tone at a band's own frequency a dB under where it started: that's its margin.
    for (const { db } of measured) expect(Math.abs(db + 1)).toBeLessThan(LEVEL_TOLERANCE_DB);
    expect(measured).toHaveLength(5);
  });
});
