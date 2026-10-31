/* From decoded samples to one byte per bucket. Pure, and fed in chunks, so a long file never sits in memory. */

const SAMPLES_PER_MS = 8;
const BYTES_PER_SAMPLE = 2;
const MIN_BUCKETS = 2000;
const BUCKETS_PER_SECOND = 4;
const FULL_SCALE = 32768;

export const DECODE_SAMPLE_RATE = SAMPLES_PER_MS * 1000;

export function bucketCount(durationMs: number): number {
  return Math.max(MIN_BUCKETS, Math.ceil((durationMs / 1000) * BUCKETS_PER_SECOND));
}

/**
 * `durationMs` only says where the buckets fall, and a tag can be wrong about it: what runs over lands in the last bucket,
 * and what falls short leaves the rest silent.
 */
export function createPeakCollector(durationMs: number) {
  const peaks = new Uint8Array(bucketCount(durationMs));
  const samplesPerBucket = (durationMs * SAMPLES_PER_MS) / peaks.length;
  let samples = 0;
  // A chunk can end halfway through a sample.
  let leftover: number | null = null;

  function addSample(sample: number): void {
    const bucket = Math.min(Math.floor(samples / samplesPerBucket), peaks.length - 1);
    const peak = Math.round((Math.abs(sample) / FULL_SCALE) * 255);
    if (peak > (peaks[bucket] ?? 0)) peaks[bucket] = peak;
    samples += 1;
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
    finish: (): Uint8Array | null => (samples === 0 ? null : peaks),
  };
}

/** A CUE track's part of its file's peaks, as a copy: a view would send the whole buffer behind it over IPC. */
export function peaksInRange(peaks: Uint8Array, fileMs: number, startMs: number, endMs: number | null): Uint8Array {
  if (fileMs <= 0) return new Uint8Array(peaks);
  const from = Math.min(Math.floor((startMs / fileMs) * peaks.length), peaks.length - 1);
  const to = endMs === null ? peaks.length : Math.ceil((endMs / fileMs) * peaks.length);
  return new Uint8Array(peaks.subarray(Math.max(from, 0), Math.max(Math.min(to, peaks.length), from + 1)));
}
