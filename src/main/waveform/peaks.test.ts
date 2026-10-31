import { describe, expect, it } from 'vitest';
import { bucketCount, createPeakCollector, peaksInRange } from '@main/waveform/peaks';

function samples(...values: number[]): Buffer {
  const buffer = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => buffer.writeInt16LE(value, index * 2));
  return buffer;
}

/** A file of 2000 buckets at 8 samples a millisecond, so 250 ms is 2000 samples, one per bucket. */
const ONE_PER_BUCKET_MS = 250;

describe('bucketCount', () => {
  it('has a floor, and four a second over it', () => {
    expect(bucketCount(1_000)).toBe(2000);
    expect(bucketCount(500_000)).toBe(2000);
    expect(bucketCount(3_600_000)).toBe(14_400);
  });
});

describe('createPeakCollector', () => {
  it('maps silence to 0 and full scale to 255, on both sides', () => {
    const collector = createPeakCollector(ONE_PER_BUCKET_MS);
    collector.add(samples(0, 32767, -32768, 16384));
    expect([...(collector.finish() ?? new Uint8Array()).subarray(0, 4)]).toEqual([0, 255, 255, 128]);
  });

  it('keeps the largest sample of a bucket', () => {
    const collector = createPeakCollector(ONE_PER_BUCKET_MS * 2);
    collector.add(samples(100, -16384, 200, 300));
    expect([...(collector.finish() ?? new Uint8Array()).subarray(0, 2)]).toEqual([128, 2]);
  });

  it('gives the same answer however the chunks fall, even inside a sample', () => {
    const whole = samples(1000, -2000, 3000, -4000);
    const collector = createPeakCollector(ONE_PER_BUCKET_MS);
    for (const byte of whole) collector.add(Buffer.from([byte]));

    const inOne = createPeakCollector(ONE_PER_BUCKET_MS);
    inOne.add(whole);
    expect(collector.finish()).toEqual(inOne.finish());
  });

  it('keeps what runs past the stated length in the last bucket, and leaves what falls short silent', () => {
    const over = createPeakCollector(ONE_PER_BUCKET_MS);
    over.add(Buffer.alloc(2000 * 2));
    over.add(samples(32767));
    expect(over.finish()?.at(-1)).toBe(255);

    const short = createPeakCollector(ONE_PER_BUCKET_MS);
    short.add(samples(32767));
    expect(short.finish()?.at(-1)).toBe(0);
  });

  it('has no peaks when nothing came out', () => {
    expect(createPeakCollector(1_000).finish()).toBeNull();
  });
});

describe('peaksInRange', () => {
  const peaks = Uint8Array.from({ length: 100 }, (_, index) => index);

  it('takes a CUE track its part of the file', () => {
    const part = peaksInRange(peaks, 10_000, 2_000, 3_000);
    expect(part.length).toBe(10);
    expect(part[0]).toBe(20);
    expect(part.at(-1)).toBe(29);
  });

  it('runs to the end of the file when the track does', () => {
    const part = peaksInRange(peaks, 10_000, 9_000, null);
    expect(part[0]).toBe(90);
    expect(part.at(-1)).toBe(99);
    expect(peaksInRange(peaks, 10_000, 0, null).length).toBe(100);
  });

  it('copies, so only this much crosses IPC', () => {
    expect(peaksInRange(peaks, 10_000, 2_000, 3_000).buffer.byteLength).toBe(10);
  });

  it('always has something, for a range too small or past the end', () => {
    expect(peaksInRange(peaks, 10_000, 5_000, 5_000).length).toBe(1);
    expect(peaksInRange(peaks, 10_000, 20_000, 30_000).length).toBe(1);
  });
});
