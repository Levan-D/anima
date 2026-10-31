import { describe, expect, it } from 'vitest';
import type { AudioFormat, SignalPath, Track } from '@shared/domain';
import {
  formatLine,
  fromFileWords,
  signalLine,
  signalNote,
  toDeviceWords,
  uncountedAlterations,
} from '@/features/Transport/utils/signalWords';
import { playerStateWith, track } from '@/lib/testing';

const CD: AudioFormat = { sampleRate: 44_100, format: 's16', channels: 2 };

function line(current: Track | null, signal: Partial<SignalPath> = {}): string | null {
  return signalLine(
    playerStateWith({
      current,
      signal: { decoded: CD, output: CD, isBitPerfect: false, alterations: [], ...signal },
    }),
  );
}

describe('signalLine', () => {
  it('has nothing to say with nothing playing', () => {
    expect(line(null)).toBeNull();
  });

  it('says bit-perfect when it is, in plain words', () => {
    expect(line(track(), { isBitPerfect: true })).toBe('FLAC | 934 kbps | 44100 Hz | stereo · Bit-perfect');
  });

  it('names the first thing that is changing the signal', () => {
    expect(line(track(), { alterations: ['Windows is mixing', 'Volume is below 100'] })).toBe(
      'FLAC | 934 kbps | 44100 Hz | stereo · Windows is mixing',
    );
  });

  it('says what the codec is, and the channels in words', () => {
    expect(line(track({ codec: 'MP3', bitrateKbps: 320, channels: 1 }), { alterations: ['Windows is mixing'] })).toBe(
      'MP3 | 320 kbps | 44100 Hz | mono · Windows is mixing',
    );
    expect(line(track({ channels: 6 }))).toContain('| 6 channels');
  });

  it('never says how long it is', () => {
    expect(line(track({ durationMs: 305_000 }))).not.toMatch(/\d:\d\d/);
  });

  it('leaves the bitrate out when it can not be known', () => {
    expect(line(track({ bitrateKbps: null }))).toBe('FLAC | 44100 Hz | stereo');
  });

  it('goes by what was decoded for what the library does not have', () => {
    expect(line(track({ channels: null, sampleRate: null }))).toBe('FLAC | 934 kbps | 44100 Hz | stereo');
  });

  it('splits into the format and what is happening to it, for narrow layouts', () => {
    const state = playerStateWith({
      current: track(),
      signal: { decoded: CD, output: CD, isBitPerfect: true, alterations: [] },
    });
    expect(formatLine(state)).toBe('FLAC | 934 kbps | 44100 Hz | stereo');
    expect(signalNote(state)).toBe('Bit-perfect');
  });

  it('keeps quiet about the signal until there is one, while a track loads', () => {
    expect(line(track(), { decoded: null, output: null })).toBe('FLAC | 934 kbps | 44100 Hz | stereo');
  });
});

describe('uncountedAlterations', () => {
  const count = (alterations: string[]) =>
    uncountedAlterations(playerStateWith({ signal: { decoded: CD, output: CD, isBitPerfect: false, alterations } }));

  it('counts what the line has no room to name', () => {
    expect(count([])).toBe(0);
    expect(count(['One'])).toBe(0);
    expect(count(['One', 'Two', 'Three'])).toBe(2);
  });
});

describe('the details', () => {
  it('say what the file holds', () => {
    const decoded = { sampleRate: 96_000, format: 's32p', channels: 2 };
    expect(fromFileWords(track({ sampleRate: 96_000, bitDepth: 24 }), decoded)).toBe('96 kHz · 24-bit · stereo');
    expect(fromFileWords(track({ bitDepth: null, codec: 'MP3' }), { ...CD, channels: 1 })).toBe(
      '44.1 kHz · MP3 · mono',
    );
  });

  it('say what the device gets', () => {
    expect(toDeviceWords({ sampleRate: 48_000, format: 'float', channels: 2 })).toBe('48 kHz · 32-bit float · stereo');
    expect(toDeviceWords({ sampleRate: 44_100, format: 's16p', channels: 6 })).toBe('44.1 kHz · 16-bit · 6 channels');
  });

  it('pass on a format that has no words, rather than saying nothing', () => {
    expect(toDeviceWords({ sampleRate: 48_000, format: 'spdif-ac3', channels: 2 })).toBe('48 kHz · spdif-ac3 · stereo');
  });
});
