/*
 * The one color on screen comes from the album. An album's average color is often too dark or too muddy to read against
 * these surfaces, so this keeps its hue and moves its lightness and chroma until it works. Done in OKLCH, because
 * lightness there is close to what the eye sees, so a hue doesn't drift on the way up.
 */
import { onPlayerChange, playerState } from '@/lib/playerStore';

export type Accent = {
  accent: string;
  onAccent: string;
};

type Rgb = [number, number, number];
type Oklch = { l: number; c: number; h: number };

/** The lightest thing accent text sits on, or an accent line runs along: --surface-active in globals.css. */
const LIGHTEST_SURFACE = '#333333';
/** --color-neutral-950 and --color-neutral-50, the two choices for text on the accent. */
const ON_ACCENT_DARK = '#0a0a0a';
const ON_ACCENT_LIGHT = '#f5f5f5';

export const MIN_CONTRAST = 4.5;

const MIN_LIGHTNESS = 0.72;
const MAX_LIGHTNESS = 0.9;
const LIGHTNESS_STEP = 0.01;
// Averaging a whole sleeve washes it out, so a real hue gets some of that back, up to about what print can hold.
const GRAY_CHROMA = 0.012;
const MIN_CHROMA = 0.06;
const MAX_CHROMA = 0.17;
const CHROMA_BOOST = 1.6;

function parseHex(color: string): Rgb | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!match) return null;
  return [
    Number.parseInt(match[1] ?? '', 16) / 255,
    Number.parseInt(match[2] ?? '', 16) / 255,
    Number.parseInt(match[3] ?? '', 16) / 255,
  ];
}

function toHex(rgb: Rgb): string {
  return `#${rgb
    .map((value) =>
      Math.round(value * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function toLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function fromLinear(value: number): number {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

function toOklch([red, green, blue]: Rgb): Oklch {
  const r = toLinear(red);
  const g = toLinear(green);
  const b = toLinear(blue);
  const lCone = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mCone = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const sCone = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * lCone - 2.428592205 * mCone + 0.4505937099 * sCone;
  const labB = 0.0259040371 * lCone + 0.7827717662 * mCone - 0.808675766 * sCone;
  return {
    l: 0.2104542553 * lCone + 0.793617785 * mCone - 0.0040720468 * sCone,
    c: Math.hypot(a, labB),
    h: Math.atan2(labB, a),
  };
}

/** Linear light, which can be outside 0 to 1 when the color doesn't exist in sRGB. */
function oklchToLinear({ l, c, h }: Oklch): Rgb {
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const lCone = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mCone = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sCone = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * lCone - 3.3077115913 * mCone + 0.2309699292 * sCone,
    -1.2684380046 * lCone + 2.6097574011 * mCone - 0.3413193965 * sCone,
    -0.0041960863 * lCone - 0.7034186147 * mCone + 1.707614701 * sCone,
  ];
}

/** Gives up chroma until the color exists, which keeps its hue and lightness. */
function toDisplayable(color: Oklch): Rgb {
  let { c } = color;
  for (;;) {
    const linear = oklchToLinear({ ...color, c });
    if (linear.every((value) => value >= -0.0005 && value <= 1.0005) || c <= 0) {
      return linear.map((value) => fromLinear(Math.min(Math.max(value, 0), 1))) as Rgb;
    }
    c = Math.max(c - 0.002, 0);
  }
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(toLinear) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG ratio, for colors given as #rrggbb. */
export function contrast(first: string, second: string): number {
  const a = luminance(parseHex(first) ?? [0, 0, 0]);
  const b = luminance(parseHex(second) ?? [0, 0, 0]);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function chromaFor(chroma: number): number {
  if (chroma < GRAY_CHROMA) return 0;
  return Math.min(Math.max(chroma * CHROMA_BOOST, MIN_CHROMA), MAX_CHROMA);
}

/** Lightness isn't luminance: a blue at the floor can still be too dim, though it gets there well before white. */
function readableColor(l: number, c: number, h: number): string {
  let lightness = Math.min(Math.max(l, MIN_LIGHTNESS), MAX_LIGHTNESS);
  let color = toHex(toDisplayable({ l: lightness, c, h }));
  while (contrast(color, LIGHTEST_SURFACE) < MIN_CONTRAST && lightness < 1) {
    lightness += LIGHTNESS_STEP;
    color = toHex(toDisplayable({ l: lightness, c, h }));
  }
  return color;
}

function textOn(color: string): string {
  return contrast(color, ON_ACCENT_DARK) >= contrast(color, ON_ACCENT_LIGHT) ? ON_ACCENT_DARK : ON_ACCENT_LIGHT;
}

/** Null for no color: the accent is then the neutral one in globals.css. */
export function accentFrom(artColor: string | null): Accent | null {
  const rgb = artColor === null ? null : parseHex(artColor);
  if (rgb === null) return null;

  const { l, c, h } = toOklch(rgb);
  const accent = readableColor(l, chromaFor(c), h);
  return { accent, onAccent: textOn(accent) };
}

/**
 * The colors that go with the accent, turned on the color wheel by these degrees: its complement, the split complement
 * either side of that, a triad and a tetrad. For when something has to stand apart from the accent.
 */
export const HARMONY_TURNS = {
  complement: 180,
  'split-a': 150,
  'split-b': 210,
  'triad-a': 120,
  'triad-b': 240,
  'tetrad-a': 90,
  'tetrad-b': 270,
} as const;
export type HarmonyName = keyof typeof HARMONY_TURNS;
export type Harmonies = Record<HarmonyName, string> & { onComplement: string };

const DEGREES_TO_RADIANS = Math.PI / 180;
// A gray has no hue to turn, so its harmonies start from a calm blue. Each keeps enough color to tell apart from the accent.
const GRAY_ART_HUE = 260 * DEGREES_TO_RADIANS;
const GRAY_ART_LIGHTNESS = 0.78;
const HARMONY_MIN_CHROMA = 0.1;

export function hueOf(color: string): number {
  return toOklch(parseHex(color) ?? [0, 0, 0]).h / DEGREES_TO_RADIANS;
}

/** On OKLCH's wheel, the one the accent is made on, at the accent's own lightness and strength. Always has an answer. */
export function harmoniesFrom(artColor: string | null): Harmonies {
  const rgb = artColor === null ? null : parseHex(artColor);
  const art = rgb === null ? null : toOklch(rgb);
  const isGray = art === null || art.c < GRAY_CHROMA;
  const l = isGray ? GRAY_ART_LIGHTNESS : art.l;
  const h = isGray ? GRAY_ART_HUE - Math.PI : art.h;
  const c = Math.max(isGray ? 0 : chromaFor(art.c), HARMONY_MIN_CHROMA);
  const turned = (turn: number) => readableColor(l, c, h + turn * DEGREES_TO_RADIANS);

  const complement = turned(HARMONY_TURNS.complement);
  return {
    complement,
    onComplement: textOn(complement),
    'split-a': turned(HARMONY_TURNS['split-a']),
    'split-b': turned(HARMONY_TURNS['split-b']),
    'triad-a': turned(HARMONY_TURNS['triad-a']),
    'triad-b': turned(HARMONY_TURNS['triad-b']),
    'tetrad-a': turned(HARMONY_TURNS['tetrad-a']),
    'tetrad-b': turned(HARMONY_TURNS['tetrad-b']),
  };
}

function applyHarmonies(artColor: string | null): void {
  const { style } = document.documentElement;
  const harmonies = harmoniesFrom(artColor);
  for (const name of Object.keys(HARMONY_TURNS) as HarmonyName[]) {
    style.setProperty(`--accent-${name}`, harmonies[name]);
  }
  style.setProperty('--on-accent-complement', harmonies.onComplement);
}

export type Wash = [string, string, string];

const WASH_HUE_TURN = 0.6;
const WASH_SHADES = [
  { l: 0.3, turn: 0 },
  { l: 0.25, turn: WASH_HUE_TURN },
  { l: 0.22, turn: -WASH_HUE_TURN },
] as const;
const WASH_MIN_CHROMA = 0.05;
const WASH_MAX_CHROMA = 0.11;

/** The album's hue and its two neighbours, kept dark enough that text on them reads. Null for no color. */
export function washFrom(artColor: string | null): Wash | null {
  const rgb = artColor === null ? null : parseHex(artColor);
  if (rgb === null) return null;

  const { c, h } = toOklch(rgb);
  const chroma = c < GRAY_CHROMA ? 0 : Math.min(Math.max(c * CHROMA_BOOST, WASH_MIN_CHROMA), WASH_MAX_CHROMA);
  const [first, second, third] = WASH_SHADES.map(({ l, turn }) => toHex(toDisplayable({ l, c: chroma, h: h + turn })));
  return first === undefined || second === undefined || third === undefined ? null : [first, second, third];
}

function applyAccent(accent: Accent | null): void {
  const { style } = document.documentElement;
  if (accent === null) {
    style.removeProperty('--accent');
    style.removeProperty('--on-accent');
    return;
  }
  style.setProperty('--accent', accent.accent);
  style.setProperty('--on-accent', accent.onAccent);
}

/** Lasts as long as the page. Both variables are registered in globals.css, which is what lets them ease. */
export function startAlbumAccentSync(): void {
  let shown: string | null = null;
  const follow = (color: string | null) => {
    if (color === shown) return;
    shown = color;
    applyAccent(accentFrom(color));
    applyHarmonies(color);
  };

  // Unlike the accent they have no neutral in the CSS to fall back on, so no color still has to write them once.
  applyHarmonies(null);

  follow(playerState().current?.artColor ?? null);
  onPlayerChange((state) => follow(state.current?.artColor ?? null));
}
