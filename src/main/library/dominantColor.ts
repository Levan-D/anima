const HUE_BINS = 24;
const MIN_SATURATION = 0.2;
/** How much of the image, weighted, a color has to cover to speak for it. */
const MIN_PRESENCE = 0.015;

function hex(r: number, g: number, b: number): string {
  const channel = (value: number) => Math.round(value).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/**
 * Turns decoded rgb24 pixels into one color for the accent. A plain average of album art comes out
 * muddy, so this looks for the hue with the most saturated, mid-brightness area, and only falls
 * back to the average when the image has none, as black-and-white art doesn't.
 */
export function dominantColor(pixels: Uint8Array): string | null {
  const count = Math.floor(pixels.length / 3);
  if (count === 0) return null;

  const bins = Array.from({ length: HUE_BINS }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));
  let totalR = 0;
  let totalG = 0;
  let totalB = 0;

  for (let index = 0; index < count; index++) {
    const r = pixels[index * 3] ?? 0;
    const g = pixels[index * 3 + 1] ?? 0;
    const b = pixels[index * 3 + 2] ?? 0;
    totalR += r;
    totalG += g;
    totalB += b;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 510;
    const midBrightness = 1 - Math.abs(2 * lightness - 1);
    if (midBrightness === 0) continue;

    const saturation = (max - min) / 255 / midBrightness;
    if (saturation < MIN_SATURATION) continue;

    const range = max - min;
    let hue: number;
    if (max === r) hue = ((g - b) / range + 6) % 6;
    else if (max === g) hue = (b - r) / range + 2;
    else hue = (r - g) / range + 4;

    const bin = bins[Math.floor((hue / 6) * HUE_BINS) % HUE_BINS];
    if (!bin) continue;
    const weight = saturation * saturation * midBrightness;
    bin.weight += weight;
    bin.r += r * weight;
    bin.g += g * weight;
    bin.b += b * weight;
  }

  const best = bins.reduce((top, bin) => (bin.weight > top.weight ? bin : top));
  if (best.weight / count >= MIN_PRESENCE) return hex(best.r / best.weight, best.g / best.weight, best.b / best.weight);
  return hex(totalR / count, totalG / count, totalB / count);
}
