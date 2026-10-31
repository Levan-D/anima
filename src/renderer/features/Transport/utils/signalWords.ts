import { sampleFormatWords, type AudioFormat, type PlayerState, type SignalPath, type Track } from '@shared/domain';
import { joinParts } from '@/lib/format';

function kilohertz(rate: number): string {
  return `${rate / 1000} kHz`;
}

function channelWords(channels: number): string {
  if (channels === 1) return 'mono';
  return channels === 2 ? 'stereo' : `${channels} channels`;
}

function alterationNote({ decoded, output, isBitPerfect, alterations }: SignalPath): string | null {
  if (decoded === null || output === null) return null;
  return isBitPerfect ? 'Bit-perfect' : (alterations[0] ?? null);
}

/**
 * `44.1 kHz · 16-bit · Bit-perfect`, or what's in the way of that. Null with nothing playing. The depth comes from the
 * file, because a 24-bit FLAC decodes into 32-bit samples, and an MP3 has no depth to speak of, so it just says MP3.
 */
export function signalLine({ current, signal }: PlayerState): string | null {
  if (current === null) return null;
  return joinParts(fileWords(current, signal.decoded), alterationNote(signal));
}

function fileWords({ sampleRate, bitDepth, codec }: Track, decoded: AudioFormat | null): string {
  const rate = sampleRate ?? decoded?.sampleRate ?? null;
  return joinParts(rate === null ? null : kilohertz(rate), bitDepth === null ? codec : `${bitDepth}-bit`);
}

/** How many more things are changing the signal than the line has room to name. */
export function uncountedAlterations({ signal }: PlayerState): number {
  return Math.max(signal.alterations.length - 1, 0);
}

/** What the file holds, whatever it decodes into. */
export function fromFileWords(track: Track, decoded: AudioFormat): string {
  return joinParts(fileWords(track, decoded), channelWords(decoded.channels));
}

export function toDeviceWords({ sampleRate, format, channels }: AudioFormat): string {
  return joinParts(kilohertz(sampleRate), sampleFormatWords(format), channelWords(channels));
}
