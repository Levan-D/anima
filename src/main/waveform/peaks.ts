/* From decoded samples to two bytes per bucket. Pure, and fed in chunks, so a long file never sits in memory. */

import type { WaveformData } from '@shared/domain';

const BYTES_PER_SAMPLE = 2;
const MIN_BUCKETS = 2000;
const BUCKETS_PER_SECOND = 4;
const FULL_SCALE = 32768;
const TOP = 255;

/** Most of the library is at this rate, so there's nothing to resample, and it's no slower than 8 kHz was. */
export const DECODE_SAMPLE_RATE = 44_100;

export function bucketCount(durationMs: number): number {
  return Math.max(MIN_BUCKETS, Math.ceil((durationMs / 1000) * BUCKETS_PER_SECOND));
}

/**
 * `durationMs` only says where the buckets fall, and a tag can be wrong about it: what runs over lands in the last bucket,
 * and what falls short leaves the rest silent.
 */
export function createPeakCollector(durationMs: number) {
  const buckets = bucketCount(durationMs);
  const peaks = new Uint8Array(buckets);
  const squares = new Float64Array(buckets);
  const counts = new Uint32Array(buckets);
  const samplesPerBucket = (durationMs * DECODE_SAMPLE_RATE) / 1000 / buckets;
  let samples = 0;
  // A chunk can end halfway through a sample.
  let leftover: number | null = null;

  function addSample(sample: number): void {
    const bucket = Math.min(Math.floor(samples / samplesPerBucket), buckets - 1);
    const peak = Math.round((Math.abs(sample) / FULL_SCALE) * TOP);
    if (peak > (peaks[bucket] ?? 0)) peaks[bucket] = peak;
    squares[bucket] = (squares[bucket] ?? 0) + sample * sample;
    counts[bucket] = (counts[bucket] ?? 0) + 1;
    samples += 1;
  }

  function rmsLevels(): Uint8Array {
    return Uint8Array.from(squares, (square, bucket) => {
      const count = counts[bucket] ?? 0;
      return count === 0 ? 0 : Math.round((Math.sqrt(square / count) / FULL_SCALE) * TOP);
    });
  }

  return {
    /** Signed 16-bit little-endian mono. */
    add(chunk: Buffer): void {
      if (chunk.length === 0) return;
      let offset = 0;
      if (leftover !== null) {
        addSample(Buffer.from([leftover, chunk.readUInt8(0)]).readInt16LE(0));
        leftover = null;
        offset = 1;
      }
      for (; offset + BYTES_PER_SAMPLE <= chunk.length; offset += BYTES_PER_SAMPLE)
        addSample(chunk.readInt16LE(offset));
      if (offset < chunk.length) leftover = chunk.readUInt8(offset);
    },

    /** Null when no audio came out at all. */
    finish: (): WaveformData | null => (samples === 0 ? null : { peaks, rms: rmsLevels() }),
  };
}

function rangeOf(levels: Uint8Array, fileMs: number, startMs: number, endMs: number | null): Uint8Array {
  if (fileMs <= 0) return new Uint8Array(levels);
  const from = Math.min(Math.floor((startMs / fileMs) * levels.length), levels.length - 1);
  const to = endMs === null ? levels.length : Math.ceil((endMs / fileMs) * levels.length);
  return new Uint8Array(levels.subarray(Math.max(from, 0), Math.max(Math.min(to, levels.length), from + 1)));
}

/** A CUE track's part of its file's levels, as copies: a view would send the whole buffer behind it over IPC. */
export function levelsInRange(
  { peaks, rms }: WaveformData,
  fileMs: number,
  startMs: number,
  endMs: number | null,
): WaveformData {
  return { peaks: rangeOf(peaks, fileMs, startMs, endMs), rms: rangeOf(rms, fileMs, startMs, endMs) };
}
