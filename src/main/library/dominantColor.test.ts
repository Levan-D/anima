import { describe, expect, it } from 'vitest';
import { dominantColor } from '@main/library/dominantColor';

type Rgb = [number, number, number];

function pixels(...runs: [Rgb, number][]): Uint8Array {
  return Uint8Array.from(runs.flatMap(([rgb, count]) => Array.from({ length: count }, () => rgb).flat()));
}

function channels(color: string | null): Rgb {
  if (color === null) throw new Error('No color');
  return [0, 2, 4].map((start) => Number.parseInt(color.slice(start + 1, start + 3), 16)) as Rgb;
}

describe('dominantColor', () => {
  it('has nothing to say with no pixels', () => {
    expect(dominantColor(new Uint8Array())).toBeNull();
  });

  it('formats as #rrggbb', () => {
    expect(dominantColor(pixels([[255, 0, 0], 256]))).toBe('#ff0000');
    expect(dominantColor(pixels([[1, 2, 3], 256]))).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('returns a solid color as it is', () => {
    expect(dominantColor(pixels([[200, 40, 90], 256]))).toBe('#c8285a');
  });

  it('prefers a saturated area over a bigger gray one', () => {
    const [r, g, b] = channels(dominantColor(pixels([[128, 128, 128], 200], [[220, 30, 30], 56])));
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(60);
    expect(b).toBeLessThan(60);
  });

  it('prefers a small vivid area over a large dark one, which is what a plain average gets wrong', () => {
    const color = pixels([[10, 10, 12], 236], [[30, 80, 230], 20]);
    const [r, g, b] = channels(dominantColor(color));
    expect(b).toBeGreaterThan(200);
    expect(r).toBeLessThan(60);
    expect(g).toBeLessThan(100);
  });

  it('prefers mid-brightness over a pale version of the same hue', () => {
    const [, g] = channels(dominantColor(pixels([[255, 230, 230], 128], [[200, 30, 30], 128])));
    expect(g).toBeLessThan(120);
  });

  it('picks the hue with the most weight, instead of mixing two of them', () => {
    const [r, g, b] = channels(dominantColor(pixels([[230, 30, 30], 160], [[30, 30, 230], 96])));
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(60);
    expect(b).toBeLessThan(60);
  });

  it('falls back to the average for black-and-white art', () => {
    expect(dominantColor(pixels([[0, 0, 0], 128], [[255, 255, 255], 128]))).toBe('#808080');
  });

  it('falls back to the average for gray art', () => {
    expect(dominantColor(pixels([[100, 100, 100], 128], [[50, 50, 50], 128]))).toBe('#4b4b4b');
  });

  it('falls back to the average when the color is only a speck', () => {
    expect(dominantColor(pixels([[50, 50, 50], 254], [[255, 0, 0], 2]))).toBe('#343232');
  });

  it('ignores a trailing partial pixel', () => {
    expect(dominantColor(Uint8Array.from([255, 0, 0, 99]))).toBe('#ff0000');
  });

  it('copes with pure black and pure white', () => {
    expect(dominantColor(pixels([[0, 0, 0], 256]))).toBe('#000000');
    expect(dominantColor(pixels([[255, 255, 255], 256]))).toBe('#ffffff');
  });
});
