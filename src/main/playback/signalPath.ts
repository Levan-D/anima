/* What's happening to the signal, in plain words. Exclusive doesn't turn anything else off, this just tells the truth. */

import {
  sampleFormatWords,
  type AudioFormat,
  type OutputMode,
  type ReplayGainMode,
  type SignalKind,
  type SignalPath,
} from '@shared/domain';

export type ReplayGainTags = {
  trackGainDb: number | null;
  trackPeak: number | null;
  albumGainDb: number | null;
  albumPeak: number | null;
};

export type SignalInput = {
  decoded: AudioFormat | null;
  output: AudioFormat | null;
  outputMode: OutputMode;
  eqAudible: boolean;
  /** How far the EQ may pass full scale, from `clipDb`. Only ever above 0 with the preamp set by hand. */
  eqClipDb: number;
  /** What the gain comes to for this file, from `appliedGainDb`. */
  replayGainDb: number;
  volume: number;
  muted: boolean;
};

function kilohertz(rate: number): string {
  return `${rate / 1000} kHz`;
}

function channelWords(channels: number): string {
  if (channels === 1) return 'mono';
  return channels === 2 ? 'stereo' : `${channels} channels`;
}

/**
 * mpv's own sum. Album mode uses the album's gain, which the file's tags fall back to the track's for. A peak over
 * full scale after the gain turns the gain down to fit, since nothing here sets --replaygain-clip.
 */
export function appliedGainDb(mode: ReplayGainMode, tags: ReplayGainTags | null): number {
  if (mode === 'off' || tags === null) return 0;
  const gain = mode === 'album' ? (tags.albumGainDb ?? tags.trackGainDb) : tags.trackGainDb;
  if (gain === null) return 0;
  const peak = mode === 'album' ? (tags.albumPeak ?? tags.trackPeak) : tags.trackPeak;
  return peak === null || peak <= 0 ? gain : Math.min(gain, -20 * Math.log10(peak));
}

/** The format is the only thing still altered, so an output opened afresh would be bit-perfect. */
export function reopenWouldRestore(input: SignalInput): boolean {
  const { decoded, output } = input;
  if (decoded === null || output === null) return false;
  const isConverted = sampleFormatWords(output.format) !== sampleFormatWords(decoded.format);
  return isConverted && signalPath(input).alterations.length === 1;
}

export function signalPath({
  decoded,
  output,
  outputMode,
  eqAudible,
  eqClipDb,
  replayGainDb,
  volume,
  muted,
}: SignalInput): SignalPath {
  if (decoded === null || output === null) return { decoded, output, isBitPerfect: false, kind: null, alterations: [] };

  const isMixed = outputMode === 'shared';
  const isResampled = output.sampleRate !== decoded.sampleRate;
  const isConverted = sampleFormatWords(output.format) !== sampleFormatWords(decoded.format);
  const isRemixed = output.channels !== decoded.channels;

  const alterations = [
    isMixed && 'Windows is mixing',
    eqAudible && 'EQ is on',
    eqAudible && eqClipDb > 0 && `EQ may clip by about +${eqClipDb} dB`,
    replayGainDb !== 0 && 'ReplayGain is changing the level',
    volume < 100 && 'Volume is below 100',
    muted && 'Muted',
    isResampled && `Resampled to ${kilohertz(output.sampleRate)}`,
    isConverted && `Converted to ${sampleFormatWords(output.format)}`,
    isRemixed && `Mixed to ${channelWords(output.channels)}`,
  ].filter((alteration) => alteration !== false);

  const isBitPerfect = alterations.length === 0;
  // The chain runs in doubles and whatever comes out of it is a new format. That's the EQ's doing, and goes when it does.
  const isConvertedAnyway = isConverted && !eqAudible;
  // The output wins over what I chose: turning my changes off wouldn't get it back to bit-perfect while it's altering it too.
  const alteredBy: SignalKind = isMixed || isResampled || isConvertedAnyway || isRemixed ? 'system' : 'adjusted';
  return { decoded, output, isBitPerfect, kind: isBitPerfect ? 'bit-perfect' : alteredBy, alterations };
}
