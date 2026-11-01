/*
 * Equal-loudness contours from ISO 226:2003, equation (1) as quoted in Suzuki, Takeshima & Kurakata 2024,
 * https://doi.org/10.1250/ast.e23.66. The standard's own text is paywalled, so its tables are as printed in IoSR's iso226.m,
 * https://github.com/IoSR-Surrey/MatlabToolbox. The standard stops at 12.5 kHz, so the lines do too.
 */

const HZ = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150,
  4000, 5000, 6300, 8000, 10_000, 12_500,
];
const ALPHA = [
  0.532, 0.506, 0.48, 0.455, 0.432, 0.409, 0.387, 0.367, 0.349, 0.33, 0.315, 0.301, 0.288, 0.276, 0.267, 0.259, 0.253,
  0.25, 0.246, 0.244, 0.243, 0.243, 0.243, 0.242, 0.242, 0.245, 0.254, 0.271, 0.301,
];
const LU = [
  -31.6, -27.2, -23, -19.1, -15.9, -13, -10.3, -8.1, -6.2, -4.5, -3.1, -2, -1.1, -0.4, 0, 0.3, 0.5, 0, -2.7, -4.1, -1,
  1.7, 2.5, 1.2, -2.1, -7.1, -11.2, -10.7, -3.1,
];
const THRESHOLD = [
  78.5, 68.7, 59.5, 51.1, 44, 37.5, 31.5, 26.5, 22.1, 17.9, 14.4, 11.4, 8.6, 6.2, 4.4, 3, 2.2, 2.4, 3.5, 1.7, -1.3,
  -4.2, -6, -5.4, -1.5, 6, 12.6, 13.9, 12.3,
];

export type ContourPoint = {
  hz: number;
  splDb: number;
};

/** The sound pressure level, across the table's frequencies, that sounds as loud as `phon` dB does at 1 kHz. */
export function equalLoudnessContour(phon: number): ContourPoint[] {
  return HZ.map((hz, index) => {
    const alpha = ALPHA[index] ?? 0;
    const lu = LU[index] ?? 0;
    const threshold = THRESHOLD[index] ?? 0;
    const af = 4.47e-3 * (10 ** (0.025 * phon) - 1.15) + (0.4 * 10 ** ((threshold + lu) / 10 - 9)) ** alpha;
    return { hz, splDb: (10 / alpha) * Math.log10(af) - lu + 94 };
  });
}
