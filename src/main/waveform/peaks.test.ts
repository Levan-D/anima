import { describe, expect, it } from 'vitest';
import { bucketCount, createPeakCollector, DECODE_SAMPLE_RATE, levelsInRange } from '@main/waveform/peaks';

function samples(...values: number[]): Buffer {
  const buffer = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => buffer.writeInt16LE(value, index * 2));
  return buffer;
}

/** A file of 2000 buckets, with this long being 2000 samples, one per bucket. */
const ONE_PER_BUCKET_MS = (2000 * 1000) / DECODE_SAMPLE_RATE;

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
    expect([...(collector.finish()?.peaks ?? new Uint8Array()).subarray(0, 4)]).toEqual([0, 255, 255, 128]);
  });

  it('keeps the largest sample of a bucket', () => {
    const collector = createPeakCollector(ONE_PER_BUCKET_MS * 2);
    collector.add(samples(100, -16384, 200, 300));
    expect([...(collector.finish()?.peaks ?? new Uint8Array()).subarray(0, 2)]).toEqual([128, 2]);
  });

  it('works out the RMS of a bucket, on the same scale, at most its peak', () => {
    const collector = createPeakCollector(ONE_PER_BUCKET_MS * 2);
    collector.add(samples(16384, -16384, 32767, 0));
    const levels = collector.finish();
    expect(levels?.rms[0]).toBe(128);
    expect(levels?.peaks[0]).toBe(128);
    expect(levels?.rms[1]).toBe(180);
    expect(levels?.peaks[1]).toBe(255);
  });

  it('has an RMS of zero for silence, and where nothing came', () => {
    const collector = createPeakCollector(ONE_PER_BUCKET_MS);
    collector.add(samples(0));
    const levels = collector.finish();
    expect(levels?.rms[0]).toBe(0);
    expect(levels?.rms.at(-1)).toBe(0);
    expect(levels?.rms.length).toBe(levels?.peaks.length);
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
    expect(over.finish()?.peaks.at(-1)).toBe(255);

    const short = createPeakCollector(ONE_PER_BUCKET_MS);
    short.add(samples(32767));
    expect(short.finish()?.peaks.at(-1)).toBe(0);
  });

  it('has no peaks when nothing came out', () => {
    expect(createPeakCollector(1_000).finish()).toBeNull();
  });
});

describe('levelsInRange', () => {
  const whole = {
    peaks: Uint8Array.from({ length: 100 }, (_, index) => index),
    rms: Uint8Array.from({ length: 100 }, (_, index) => 100 - index),
  };

  it('takes a CUE track its part of the file', () => {
    const { peaks, rms } = levelsInRange(whole, 10_000, 2_000, 3_000);
    expect(peaks.length).toBe(10);
    expect(peaks[0]).toBe(20);
    expect(peaks.at(-1)).toBe(29);
    expect(rms.length).toBe(10);
    expect(rms[0]).toBe(80);
  });

  it('runs to the end of the file when the track does', () => {
    const { peaks } = levelsInRange(whole, 10_000, 9_000, null);
    expect(peaks[0]).toBe(90);
    expect(peaks.at(-1)).toBe(99);
    expect(levelsInRange(whole, 10_000, 0, null).peaks.length).toBe(100);
  });

  it('copies, so only this much crosses IPC', () => {
    const { peaks, rms } = levelsInRange(whole, 10_000, 2_000, 3_000);
    expect(peaks.buffer.byteLength).toBe(10);
    expect(rms.buffer.byteLength).toBe(10);
  });

  it('always has something, for a range too small or past the end', () => {
    expect(levelsInRange(whole, 10_000, 5_000, 5_000).peaks.length).toBe(1);
    expect(levelsInRange(whole, 10_000, 20_000, 30_000).peaks.length).toBe(1);
  });
});
