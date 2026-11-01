import { describe, expect, it } from 'vitest';
import type { Track } from '@shared/domain';
import { formatLine, shortFormat, signalLabel } from '@/features/Transport/utils/signalWords';
import { playerStateWith, track } from '@/lib/testing';

const state = (current: Track | null) => playerStateWith({ current });

describe('formatLine', () => {
  it('has nothing to say with nothing playing', () => {
    expect(formatLine(state(null))).toBeNull();
  });

  it('says what the codec is, and the channels in words', () => {
    expect(formatLine(state(track()))).toBe('FLAC | 934 kbps | 44100 Hz | stereo');
    expect(formatLine(state(track({ codec: 'MP3', bitrateKbps: 320, channels: 1 })))).toBe(
      'MP3 | 320 kbps | 44100 Hz | mono',
    );
    expect(formatLine(state(track({ channels: 6 })))).toContain('| 6 channels');
  });

  it('leaves the bitrate out when it can not be known', () => {
    expect(formatLine(state(track({ bitrateKbps: null })))).toBe('FLAC | 44100 Hz | stereo');
  });
});

describe('shortFormat', () => {
  it('says the codec and the rate in kHz', () => {
    expect(shortFormat(state(track({ sampleRate: 96_000 })))).toBe('FLAC · 96 kHz');
    expect(shortFormat(state(track({ sampleRate: 44_100 })))).toBe('FLAC · 44.1 kHz');
  });

  it('has nothing to say with nothing playing', () => {
    expect(shortFormat(state(null))).toBeNull();
  });
});

describe('signalLabel', () => {
  it('says in words what the dot says in color', () => {
    expect(signalLabel('FLAC · 96 kHz', 'adjusted')).toBe('Signal: FLAC · 96 kHz, Altered on purpose');
    expect(signalLabel('FLAC · 96 kHz', null)).toBe('Signal: FLAC · 96 kHz');
  });
});
