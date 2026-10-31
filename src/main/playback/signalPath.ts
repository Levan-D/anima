/* What's happening to the signal, in plain words. Exclusive doesn't turn anything else off, this just tells the truth. */

import {
  sampleFormatWords,
  type AudioFormat,
  type OutputMode,
  type ReplayGainMode,
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
  eqEnabled: boolean;
  /** What the gain comes to for this file, from `appliedGainDb`. */
  replayGainDb: number;
  volume: number;
  muted: boolean;
};

function kilohertz(rate: number): string {
  return `${rate / 1000} kHz`;
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

export function signalPath({
  decoded,
  output,
  outputMode,
  eqEnabled,
  replayGainDb,
  volume,
  muted,
}: SignalInput): SignalPath {
  if (decoded === null || output === null) return { decoded, output, isBitPerfect: false, alterations: [] };

  const alterations = [
    outputMode === 'shared' && 'Windows is mixing',
    eqEnabled && 'EQ is on',
    replayGainDb !== 0 && 'ReplayGain is changing the level',
    volume < 100 && 'Volume is below 100',
    muted && 'Muted',
    output.sampleRate !== decoded.sampleRate && `Resampled to ${kilohertz(output.sampleRate)}`,
    sampleFormatWords(output.format) !== sampleFormatWords(decoded.format) &&
      `Converted to ${sampleFormatWords(output.format)}`,
    output.channels !== decoded.channels && `Mixed to ${output.channels} channels`,
  ].filter((alteration) => alteration !== false);

  return { decoded, output, isBitPerfect: alterations.length === 0, alterations };
}
