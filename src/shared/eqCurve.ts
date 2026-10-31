/* The response of an EQ, from the same RBJ biquads ffmpeg's filters are. Main takes its headroom from this, and the UI draws it. */

import type { EqBand, EqSettings } from '@shared/domain';

export const CURVE_SAMPLE_RATE = 44_100;

type Biquad = { b0: number; b1: number; b2: number; a0: number; a1: number; a2: number };

function biquadOf({ kind, frequencyHz, gainDb, q }: EqBand, sampleRate: number): Biquad {
  const A = 10 ** (gainDb / 40);
  const w0 = (2 * Math.PI * frequencyHz) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const shelf = 2 * Math.sqrt(A) * alpha;

  switch (kind) {
    case 'peak':
      return {
        b0: 1 + alpha * A,
        b1: -2 * cos,
        b2: 1 - alpha * A,
        a0: 1 + alpha / A,
        a1: -2 * cos,
        a2: 1 - alpha / A,
      };
    case 'lowshelf':
      return {
        b0: A * (A + 1 - (A - 1) * cos + shelf),
        b1: 2 * A * (A - 1 - (A + 1) * cos),
        b2: A * (A + 1 - (A - 1) * cos - shelf),
        a0: A + 1 + (A - 1) * cos + shelf,
        a1: -2 * (A - 1 + (A + 1) * cos),
        a2: A + 1 + (A - 1) * cos - shelf,
      };
    case 'highshelf':
      return {
        b0: A * (A + 1 + (A - 1) * cos + shelf),
        b1: -2 * A * (A - 1 + (A + 1) * cos),
        b2: A * (A + 1 + (A - 1) * cos - shelf),
        a0: A + 1 - (A - 1) * cos + shelf,
        a1: 2 * (A - 1 - (A + 1) * cos),
        a2: A + 1 - (A - 1) * cos - shelf,
      };
  }
}

/** RBJ's form in sin²(w/2), which holds its accuracy at low frequencies where the plain form cancels itself out. */
function powerAt(c0: number, c1: number, c2: number, phi: number): number {
  return (c0 + c1 + c2) ** 2 - 4 * (c0 * c1 + 4 * c0 * c2 + c1 * c2) * phi + 16 * c0 * c2 * phi * phi;
}

export function curveDb(bands: readonly EqBand[], hz: number, sampleRate = CURVE_SAMPLE_RATE): number {
  const phi = Math.sin((Math.PI * hz) / sampleRate) ** 2;
  let total = 0;
  for (const band of bands) {
    const { b0, b1, b2, a0, a1, a2 } = biquadOf(band, sampleRate);
    total += 10 * Math.log10(powerAt(b0, b1, b2, phi) / powerAt(a0, a1, a2, phi));
  }
  return total;
}

// The chain is the same for every file, so its headroom has to hold at every rate a file can have. The curves differ near
// the top, where a digital filter bends towards Nyquist.
const HEADROOM_RATES = [44_100, 48_000, 96_000, 192_000];
const GRID_POINTS = 512;
const GRID_BOTTOM_HZ = 10;
const ROUNDING_NOISE = 1e-6;

function peakAt(bands: readonly EqBand[], sampleRate: number): number {
  const nyquist = sampleRate / 2;
  let peak = Math.max(curveDb(bands, 0, sampleRate), curveDb(bands, nyquist, sampleRate));
  for (const { frequencyHz } of bands) peak = Math.max(peak, curveDb(bands, frequencyHz, sampleRate));
  const ratio = (nyquist / GRID_BOTTOM_HZ) ** (1 / GRID_POINTS);
  for (let hz = GRID_BOTTOM_HZ, point = 0; point < GRID_POINTS; point++, hz *= ratio) {
    peak = Math.max(peak, curveDb(bands, hz, sampleRate));
  }
  return peak;
}

/** How far the chain has to come down first for the curve never to rise above where it started. Never a boost. */
export function preampDb(bands: readonly EqBand[]): number {
  if (bands.length === 0) return 0;
  const peak = Math.max(...HEADROOM_RATES.map((rate) => peakAt(bands, rate)));
  return peak <= 0 ? 0 : -Math.ceil(peak * 100 - ROUNDING_NOISE) / 100;
}

/** Whether it changes anything. A switched-on EQ that's flat is no EQ at all, so the signal stays untouched. */
export function isEqAudible({ enabled, bands }: EqSettings): boolean {
  return enabled && bands.some(({ gainDb }) => gainDb !== 0);
}
