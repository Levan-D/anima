import type { PlayerState, SignalKind } from '@shared/domain';
import { joinParts } from '@/lib/format';

export const SIGNAL_LEGEND: readonly { kind: SignalKind; name: string; meaning: string }[] = [
  { kind: 'bit-perfect', name: 'Bit-perfect', meaning: 'Nothing is changing the signal' },
  { kind: 'adjusted', name: 'Adjusted by you', meaning: 'EQ, ReplayGain or volume' },
  { kind: 'system', name: 'Altered by Windows', meaning: 'Mixing, resampling or converting' },
];

function channelWords(channels: number): string {
  if (channels === 1) return 'mono';
  return channels === 2 ? 'stereo' : `${channels} channels`;
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

/** `FLAC · 96 kHz`. Null with nothing playing. */
export function shortFormat({ current, signal: { decoded } }: PlayerState): string | null {
  if (current === null) return null;
  const rate = current.sampleRate ?? decoded?.sampleRate ?? null;
  return joinParts(current.codec, rate === null ? null : `${rate / 1000} kHz`);
}

/** What the button says to a screen reader, which gets no dot. */
export function signalLabel(short: string, kind: SignalKind | null): string {
  const name = SIGNAL_LEGEND.find((entry) => entry.kind === kind)?.name ?? null;
  return `Signal: ${name === null ? short : `${short}, ${name}`}`;
}
