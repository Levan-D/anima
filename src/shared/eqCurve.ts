/* The response of an EQ, from the same RBJ biquads ffmpeg's filters are. Main takes its headroom from this, and the UI draws it. */

import type { EqBand, EqSettings } from '@shared/domain';

/** The rate to draw at before a track has said its own. */
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

/** ffmpeg's biquads pass the signal through untouched above Nyquist, with only a warning in its log. At Nyquist they still run. */
export function isBandActive({ frequencyHz }: Pick<EqBand, 'frequencyHz'>, sampleRate: number): boolean {
  return frequencyHz * 2 <= sampleRate;
}

/** At a file's own rate, since the same bands make a different curve at each one. Nothing exists above Nyquist, so it stops there. */
export function curveDb(bands: readonly EqBand[], hz: number, sampleRate: number): number {
  const phi = Math.sin((Math.PI * Math.min(hz, sampleRate / 2)) / sampleRate) ** 2;
  let total = 0;
  for (const band of bands) {
    if (!isBandActive(band, sampleRate)) continue;
    // Exactly on Nyquist top and bottom cancel: a low shelf is its gain everywhere, and the others do nothing. Measured.
    if (band.frequencyHz * 2 === sampleRate) {
      if (band.kind === 'lowshelf') total += band.gainDb;
      continue;
    }
    const { b0, b1, b2, a0, a1, a2 } = biquadOf(band, sampleRate);
    total += 10 * Math.log10(powerAt(b0, b1, b2, phi) / powerAt(a0, a1, a2, phi));
  }
  return total;
}

// The chain is the same for every file, so its headroom has to hold at every rate a file can have. The curves differ near
// the top, where a digital filter bends towards Nyquist. The library's rates, and a few around them.
const HEADROOM_RATES = [11_025, 22_050, 32_000, 44_100, 48_000, 88_200, 96_000, 176_400, 192_000];
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

function curvePeakDb(bands: readonly EqBand[]): number {
  return bands.length === 0 ? 0 : Math.max(...HEADROOM_RATES.map((rate) => peakAt(bands, rate)));
}

// A filter also moves phase, so a signal can peak higher even where the curve is at or under 0 dB, and a cut can too. Bringing
// the curve's top down to 0 dB isn't enough, and nothing short of a limiter guarantees it. These two come from whole tracks of
// the library, 420 across its rates and genres, through 13 curves: docs/research/headphone-eq.md, under Clipping.
const AUTO_MARGIN_DB = 1;
const AUTO_LEAST_DB = 2;

/**
 * How far the chain comes down first: the top of the curve plus a margin, and at least enough for a cut. Never a boost. It
 * holds the curve under 0 dB, and music under full scale on what was measured, but it can't promise that for every signal.
 */
export function preampDb(bands: readonly EqBand[]): number {
  if (bands.every(({ gainDb }) => gainDb === 0)) return 0;
  const peak = Math.ceil(curvePeakDb(bands) * 100 - ROUNDING_NOISE) / 100;
  return -Math.max(peak + AUTO_MARGIN_DB, AUTO_LEAST_DB);
}

/** What the chain's volume filter is set to: the automatic headroom, or the value set by hand. */
export function effectivePreampDb({ bands, preamp }: Pick<EqSettings, 'bands' | 'preamp'>): number {
  return preamp.auto ? preampDb(bands) : preamp.db;
}

/**
 * How much less room a preamp set by hand leaves than Auto would, to a tenth of a dB. So it's 0 with Auto, which can still go
 * over in rare cases. It's a warning about a likely limit, measured on music, and not a measurement of what's playing now.
 */
export function clipDb({ bands, preamp }: Pick<EqSettings, 'bands' | 'preamp'>): number {
  if (preamp.auto) return 0;
  const over = preamp.db - preampDb(bands);
  return Math.max(0, Math.ceil(over * 10 - ROUNDING_NOISE) / 10);
}

/** Whether it changes anything. A switched-on EQ that's flat at 0 dB is no EQ at all, so the signal stays untouched. */
export function isEqAudible({ enabled, bands, preamp }: EqSettings): boolean {
  return enabled && (bands.some(({ gainDb }) => gainDb !== 0) || (!preamp.auto && preamp.db !== 0));
}
