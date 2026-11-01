import { describe, expect, it } from 'vitest';
import type { AudioFormat } from '@shared/domain';
import { appliedGainDb, signalPath, type SignalInput } from './signalPath';

const CD: AudioFormat = { sampleRate: 44_100, format: 's16', channels: 2 };

function input(overrides: Partial<SignalInput> = {}): SignalInput {
  return {
    decoded: CD,
    output: CD,
    outputMode: 'exclusive',
    eqAudible: false,
    eqClipDb: 0,
    replayGainDb: 0,
    volume: 100,
    muted: false,
    ...overrides,
  };
}

describe('signalPath', () => {
  it('calls it bit-perfect only when nothing touches the signal', () => {
    expect(signalPath(input())).toEqual({
      decoded: CD,
      output: CD,
      isBitPerfect: true,
      kind: 'bit-perfect',
      alterations: [],
    });
  });

  it.each<[string, Partial<SignalInput>, string]>([
    ['EQ', { eqAudible: true }, 'adjusted'],
    ['ReplayGain and volume', { replayGainDb: -3, volume: 50 }, 'adjusted'],
    ['mute', { muted: true }, 'adjusted'],
    ['shared mode', { outputMode: 'shared' }, 'system'],
    ['a resample', { output: { ...CD, sampleRate: 48_000 } }, 'system'],
    ['a change of format', { output: { ...CD, format: 's32' } }, 'system'],
    ['a downmix', { decoded: { ...CD, channels: 6 } }, 'system'],
    ['EQ as well as shared mode', { eqAudible: true, outputMode: 'shared' }, 'system'],
  ])('puts %s down as %s', (_name, change, kind) => {
    expect(signalPath(input(change)).kind).toBe(kind);
  });

  it.each<[string, Partial<SignalInput>, string]>([
    ['shared mode', { outputMode: 'shared' }, 'Windows is mixing'],
    ['EQ', { eqAudible: true }, 'EQ is on'],
    ['ReplayGain', { replayGainDb: -6.21 }, 'ReplayGain is changing the level'],
    ['volume', { volume: 99 }, 'Volume is below 100'],
    ['mute', { muted: true }, 'Muted'],
    ['a resample', { output: { ...CD, sampleRate: 48_000 } }, 'Resampled to 48 kHz'],
    ['a resample to a fraction of a kHz', { decoded: { ...CD, sampleRate: 96_000 } }, 'Resampled to 44.1 kHz'],
    ['a change of format', { output: { ...CD, format: 's32' } }, 'Converted to 32-bit'],
    ['a change to float', { output: { ...CD, format: 'float' } }, 'Converted to 32-bit float'],
    ['a format with no words for it', { output: { ...CD, format: 'dts' } }, 'Converted to dts'],
    ['a downmix', { decoded: { ...CD, channels: 6 } }, 'Mixed to 2 channels'],
  ])('names %s, and it is not bit-perfect', (_name, change, words) => {
    const signal = signalPath(input(change));
    expect(signal.alterations).toEqual([words]);
    expect(signal.isBitPerfect).toBe(false);
  });

  it('names every reason there is', () => {
    const { alterations, isBitPerfect } = signalPath(
      input({
        outputMode: 'shared',
        replayGainDb: -3,
        volume: 50,
        muted: true,
        output: { ...CD, sampleRate: 48_000, format: 'float' },
      }),
    );
    expect(isBitPerfect).toBe(false);
    expect(alterations).toEqual([
      'Windows is mixing',
      'ReplayGain is changing the level',
      'Volume is below 100',
      'Muted',
      'Resampled to 48 kHz',
      'Converted to 32-bit float',
    ]);
  });

  it('counts planar and interleaved as the same samples', () => {
    const signal = signalPath(input({ decoded: { ...CD, format: 'floatp' }, output: { ...CD, format: 'float' } }));
    expect(signal.isBitPerfect).toBe(true);
    expect(signalPath(input({ decoded: { ...CD, format: 's16p' } })).isBitPerfect).toBe(true);
  });

  it('counts exactly 0 dB of ReplayGain as nothing', () => {
    expect(signalPath(input({ replayGainDb: 0 })).isBitPerfect).toBe(true);
  });

  it('says nothing about a path that is not there', () => {
    const empty = { decoded: null, output: null, isBitPerfect: false, kind: null, alterations: [] };
    expect(signalPath(input({ decoded: null, output: null }))).toEqual(empty);
    expect(signalPath(input({ decoded: CD, output: null })).isBitPerfect).toBe(false);
    expect(signalPath(input({ decoded: null, output: CD, outputMode: 'shared' })).alterations).toEqual([]);
  });
});

describe('appliedGainDb', () => {
  const tags = { trackGainDb: -6, trackPeak: 0.5, albumGainDb: -9, albumPeak: 0.6 };

  it('is nothing when off, whatever the tags say', () => {
    expect(appliedGainDb('off', tags)).toBe(0);
  });

  it('picks the track or the album', () => {
    expect(appliedGainDb('track', tags)).toBe(-6);
    expect(appliedGainDb('album', tags)).toBe(-9);
  });

  it('falls back to the track for an album gain it does not have', () => {
    expect(appliedGainDb('album', { trackGainDb: -6, trackPeak: 1, albumGainDb: null, albumPeak: null })).toBe(-6);
  });

  it('is nothing with no tags', () => {
    expect(appliedGainDb('album', null)).toBe(0);
    expect(appliedGainDb('track', { trackGainDb: null, trackPeak: null, albumGainDb: null, albumPeak: null })).toBe(0);
  });

  it('comes down to what fits under full scale, as mpv does', () => {
    expect(appliedGainDb('track', { trackGainDb: 6, trackPeak: 1, albumGainDb: null, albumPeak: null })).toBeCloseTo(0);
    expect(appliedGainDb('track', { trackGainDb: 0, trackPeak: 1.1, albumGainDb: null, albumPeak: null })).toBeCloseTo(
      -0.83,
      1,
    );
  });

  it('leaves a gain that fits alone', () => {
    expect(appliedGainDb('track', { trackGainDb: 3, trackPeak: 0.5, albumGainDb: null, albumPeak: null })).toBe(3);
  });
});
