/* The EQ through the Player against a fake mpv: what gets sent, in what order, and how little of a drag does. */

import { describe, expect, it } from 'vitest';
import { EQ_AUTO_PREAMP, type EqBand, type EqSettings } from '@shared/domain';
import { chainFor, chainSpec } from './eqChain';
import { makeHarness, type PlayerHarness } from './testFixtures';

const PEAK: EqBand = { id: 1, kind: 'peak', frequencyHz: 1000, gainDb: 6, q: 1 };
const on = (...bands: EqBand[]): EqSettings => ({ enabled: true, bands, preamp: EQ_AUTO_PREAMP });
const specOf = (eq: EqSettings) => chainSpec(chainFor(eq));
const SETTLES = 350;
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function started(options: Parameters<typeof makeHarness>[0] = {}): Promise<PlayerHarness> {
  const harness = makeHarness(options);
  harness.player.start();
  await harness.settle();
  return harness;
}

const filterCommands = ({ mpv }: PlayerHarness) =>
  mpv().commands.filter(([name]) => name === 'af' || name === 'af-command');

async function settleWithin(harness: PlayerHarness): Promise<void> {
  await wait(SETTLES);
  await harness.settle();
}

describe('at the start', () => {
  it('sends nothing with the EQ off, whatever the bands say', async () => {
    const harness = await started({ settings: { eq: { enabled: false, bands: [PEAK], preamp: EQ_AUTO_PREAMP } } });
    expect(filterCommands(harness)).toEqual([]);
  });

  it('has the chain in place before the first file', async () => {
    const eq = on(PEAK);
    const harness = makeHarness({ settings: { eq } });
    harness.player.play([1], 0);
    harness.player.start();
    await harness.settle();
    const names = harness.mpv().commands.map(([name]) => name);
    expect(names.indexOf('af')).toBeLessThan(names.indexOf('loadfile'));
    expect(harness.mpv().sent('af')).toEqual([['af', 'set', specOf(eq)]]);
  });
});

describe('at runtime', () => {
  it('sets it when it turns on, and clears it when it goes off', async () => {
    const harness = await started();
    harness.player.setEq(on(PEAK));
    await harness.settle();
    expect(harness.mpv().sent('af')).toEqual([['af', 'set', specOf(on(PEAK))]]);

    harness.player.setEq({ enabled: false, bands: [PEAK], preamp: EQ_AUTO_PREAMP });
    await harness.settle();
    expect(harness.mpv().sent('af').at(-1)).toEqual(['af', 'clr', '']);
    expect(harness.settings.get().eq).toEqual({ enabled: false, bands: [PEAK], preamp: EQ_AUTO_PREAMP });
    expect(harness.player.state().eq).toEqual({ enabled: false, bands: [PEAK], preamp: EQ_AUTO_PREAMP });
  });

  it('commands a value that moves, then sets it once it has stopped, so a seek or a new file keeps it', async () => {
    const harness = await started({ settings: { eq: on(PEAK) } });
    const moved = on({ ...PEAK, gainDb: 3 });
    harness.player.setEq(moved);
    await harness.settle();
    expect(harness.mpv().sent('af')).toHaveLength(1);
    expect(
      harness
        .mpv()
        .sent('af-command')
        .map((command) => command.slice(1)),
    ).toEqual([
      ['eq1', 'gain', '3', 'Parsed_equalizer_0'],
      ['eqpre', 'volume', '-4dB', 'Parsed_volume_0'],
    ]);

    await settleWithin(harness);
    expect(harness.mpv().sent('af').at(-1)).toEqual(['af', 'set', specOf(moved)]);
  });

  it('sets straight away when a band is added', async () => {
    const harness = await started({ settings: { eq: on(PEAK) } });
    const more = on(PEAK, { ...PEAK, id: 2, frequencyHz: 4000 });
    harness.player.setEq(more);
    await harness.settle();
    expect(harness.mpv().sent('af').at(-1)).toEqual(['af', 'set', specOf(more)]);
    expect(harness.mpv().sent('af-command')).toEqual([]);
  });

  it('coalesces a drag: only the latest value goes once mpv has answered the one before', async () => {
    const harness = await started({ settings: { eq: on(PEAK) } });
    for (let gain = 5; gain >= 1; gain -= 0.1) harness.player.setEq(on({ ...PEAK, gainDb: Number(gain.toFixed(1)) }));
    await harness.settle();

    const sent = harness
      .mpv()
      .sent('af-command')
      .map((command) => command.slice(1, 4));
    expect(sent).toEqual([
      ['eq1', 'gain', '5'],
      ['eq1', 'gain', '1'],
      ['eqpre', 'volume', '-2dB'],
    ]);
  });

  it('falls back to a set when mpv refuses a command, as it does with no file open', async () => {
    const harness = await started({ settings: { eq: on(PEAK) } });
    harness.mpv().refusing.add('af-command');
    const moved = on({ ...PEAK, gainDb: 2 });
    harness.player.setEq(moved);
    await harness.settle();
    expect(harness.mpv().sent('af').at(-1)).toEqual(['af', 'set', specOf(moved)]);
    expect(harness.mpv().sent('af-command')).toHaveLength(1);
  });

  it('keeps the chain while a drag passes through flat, and takes it out once it stays there', async () => {
    const harness = await started({ settings: { eq: on(PEAK) } });
    harness.player.setEq(on({ ...PEAK, gainDb: 0 }));
    await harness.settle();
    expect(harness.mpv().sent('af')).toHaveLength(1);

    harness.player.setEq(on({ ...PEAK, gainDb: -2 }));
    await harness.settle();
    expect(harness.mpv().sent('af')).toHaveLength(1);

    harness.player.setEq(on({ ...PEAK, gainDb: 0 }));
    await settleWithin(harness);
    expect(harness.mpv().sent('af').at(-1)).toEqual(['af', 'clr', '']);
  });
});

describe('after a restart', () => {
  it('puts the latest chain on the new mpv before it reloads the file', async () => {
    const harness = await started({ settings: { eq: on(PEAK) } });
    harness.player.play([1, 2], 0);
    await harness.settle();
    harness.mpv().startCurrent();
    await harness.settle();

    const moved = on({ ...PEAK, gainDb: 2 });
    harness.player.setEq(moved);
    harness.mpv().exit();
    await wait(1100);
    await harness.settle();

    expect(harness.spawned).toHaveLength(2);
    const names = harness.mpv().commands.map(([name]) => name);
    expect(harness.mpv().sent('af')[0]).toEqual(['af', 'set', specOf(moved)]);
    expect(names.indexOf('af')).toBeLessThan(names.indexOf('loadfile'));
    expect(harness.mpv().sent('af-command')).toEqual([]);
  });

  it('puts nothing on it when the EQ was turned off in the meantime', async () => {
    const harness = await started({ settings: { eq: on(PEAK) } });
    harness.player.setEq({ enabled: false, bands: [PEAK], preamp: EQ_AUTO_PREAMP });
    harness.mpv().exit();
    await wait(1100);
    await harness.settle();
    expect(harness.spawned).toHaveLength(2);
    expect(harness.mpv().sent('af')).toEqual([]);
  });
});

describe('the signal', () => {
  const FORMAT = { samplerate: 44_100, 'channel-count': 2, format: 's16' };

  async function bitPerfectExceptEq(eq: EqSettings): Promise<PlayerHarness> {
    const harness = await started({ settings: { outputMode: 'exclusive', replayGainMode: 'off', eq } });
    harness.player.play([1], 0);
    await harness.settle();
    harness.mpv().startCurrent();
    harness.mpv().property('audio-params', FORMAT);
    harness.mpv().property('audio-out-params', FORMAT);
    await harness.settle();
    return harness;
  }

  it('says so with a band doing something, and is not bit-perfect', async () => {
    const { signal } = (await bitPerfectExceptEq(on(PEAK))).player.state();
    expect(signal).toMatchObject({ isBitPerfect: false, alterations: ['EQ is on'] });
  });

  it('stays bit-perfect when off, and when on but flat', async () => {
    for (const eq of [{ enabled: false, bands: [PEAK], preamp: EQ_AUTO_PREAMP }, on({ ...PEAK, gainDb: 0 }), on()]) {
      const { signal } = (await bitPerfectExceptEq(eq)).player.state();
      expect(signal).toMatchObject({ isBitPerfect: true, alterations: [] });
    }
  });

  it('keeps the EQ and the output mode out of each other’s way', async () => {
    const harness = await bitPerfectExceptEq(on(PEAK));
    const before = filterCommands(harness).length;

    harness.player.setOutputMode('shared');
    await harness.settle();
    expect(harness.player.state().eq).toEqual(on(PEAK));
    expect(filterCommands(harness)).toHaveLength(before);

    const exclusiveWrites = harness.mpv().commands.filter(([, name]) => name === 'audio-exclusive').length;
    harness.player.setEq({ enabled: false, bands: [PEAK], preamp: EQ_AUTO_PREAMP });
    await harness.settle();
    expect(harness.player.state().outputMode).toBe('shared');
    expect(harness.mpv().commands.filter(([, name]) => name === 'audio-exclusive')).toHaveLength(exclusiveWrites);
  });
});
