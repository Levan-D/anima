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

/** `FLAC | 934 kbps | 44100 Hz | stereo`, leaving out what isn't known. Null with nothing playing. */
export function formatLine({ current, signal: { decoded } }: PlayerState): string | null {
  if (current === null) return null;
  const rate = current.sampleRate ?? decoded?.sampleRate ?? null;
  const channels = current.channels ?? decoded?.channels ?? null;
  return [
    current.codec,
    current.bitrateKbps === null ? null : `${current.bitrateKbps} kbps`,
    rate === null ? null : `${rate} Hz`,
    channels === null ? null : channelWords(channels),
  ]
    .filter((part) => part !== null)
    .join(' | ');
}

/** `Bit-perfect`, or the first thing in the way of that. Null until there's a signal to say it of. */
export function signalNote({ current, signal }: PlayerState): string | null {
  return current === null ? null : alterationNote(signal);
}

/** The whole line, for what isn't shown any narrower. */
export function signalLine(state: PlayerState): string | null {
  const format = formatLine(state);
  return format === null ? null : joinParts(format, signalNote(state));
}

/**
 * The depth comes from the file, because a 24-bit FLAC decodes into 32-bit samples, and an MP3 has no depth to speak of, so
 * it just says MP3.
 */
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
