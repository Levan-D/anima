import { describe, expect, it } from 'vitest';
import { BANDS, chunkStarts, melFrames, melPatches, PATCH_FRAMES, SAMPLE_RATE, unitLength } from './melSpectrogram';

function tone(hz: number, seconds: number): Float32Array {
  return Float32Array.from({ length: seconds * SAMPLE_RATE }, (_, i) => Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE));
}

function loudestBand(hz: number): number {
  const { mel, frames } = melFrames(tone(hz, 1));
  const row = mel.subarray((frames >> 1) * BANDS, ((frames >> 1) + 1) * BANDS);
  return row.indexOf(Math.max(...row));
}

describe('melFrames', () => {
  it('has a frame per hop, and nothing for too few samples', () => {
    expect(melFrames(new Float32Array(511)).frames).toBe(0);
    expect(melFrames(new Float32Array(512 + 256 * 3)).frames).toBe(4);
  });

  it('puts a tone in a band, and a higher tone in a higher one', () => {
    const low = loudestBand(440);
    const high = loudestBand(4000);
    expect(low).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(low + 20);
  });

  it('reads silence as zero', () => {
    const { mel } = melFrames(new Float32Array(SAMPLE_RATE));
    expect(mel.every((value) => value === 0)).toBe(true);
  });
});

describe('melPatches', () => {
  it('makes overlapping patches of the size the model wants', () => {
    const frames = PATCH_FRAMES + 62 * 2;
    const mel = Float32Array.from({ length: frames * BANDS }, (_, i) => Math.floor(i / BANDS));
    const { data, count } = melPatches(mel, frames);
    expect(count).toBe(3);
    expect(data.length).toBe(3 * PATCH_FRAMES * BANDS);
    expect(data[PATCH_FRAMES * BANDS]).toBe(62);
  });

  it('has none for a clip too short to fill one', () => {
    expect(melPatches(new Float32Array(BANDS * 10), 10).count).toBe(0);
  });
});

describe('chunkStarts', () => {
  it('takes the whole of a short track', () => {
    expect(chunkStarts(12)).toEqual([0]);
    expect(chunkStarts(30)).toEqual([0]);
  });

  it('spreads three chunks over a long one, all inside it', () => {
    expect(chunkStarts(300)).toEqual([45, 135, 225]);
    expect(Math.max(...chunkStarts(95))).toBeLessThanOrEqual(65);
  });

  it('merges chunks that land on each other', () => {
    expect(chunkStarts(31)).toEqual([0, 1]);
  });
});

describe('unitLength', () => {
  it('scales to length one', () => {
    expect([...(unitLength(Float64Array.of(3, 4)) ?? [])].map((value) => value.toFixed(3))).toEqual(['0.600', '0.800']);
  });

  it('refuses what has no direction', () => {
    expect(unitLength(Float64Array.of(0, 0))).toBeNull();
    expect(unitLength(Float64Array.of(Number.NaN, 1))).toBeNull();
  });
});
