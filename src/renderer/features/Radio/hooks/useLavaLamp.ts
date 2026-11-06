import { useEffect, useRef, type RefObject } from 'react';
import { prefersReducedMotion } from '@/lib/motionTokens';

/** Drawn this small and stretched, so the browser's smoothing does the soft edges for free. */
export const LAVA_WIDTH = 160;
export const LAVA_HEIGHT = 90;
const WIDTH = LAVA_WIDTH;
const HEIGHT = LAVA_HEIGHT;
const FRAME_MS = 1000 / 30;
/** Asked for a little early, so the frame after the wait still lands in time on a 60 Hz screen. */
const EARLY_MS = 10;
const BLOBS = 7;
/** Where the field turns from wax to clear: below it nothing, across it a soft edge. */
const EDGE_LOW = 0.85;
const EDGE_HIGH = 1.15;

type Rgb = readonly [number, number, number];
type Blob = { x: number; phase: number; speed: number; size: number; drift: number; color: number };

/** The same lamp every time: blobs at their own heights and speeds, rising and sinking out of step. */
const blobs: Blob[] = Array.from({ length: BLOBS }, (_, index) => ({
  x: 0.15 + ((index * 0.37) % 0.7),
  phase: index * 1.7,
  speed: 0.05 + ((index * 0.013) % 0.04),
  size: 0.07 + ((index * 0.019) % 0.06),
  drift: 0.03 + ((index * 0.011) % 0.03),
  color: index % 3,
}));

/** The wash is kept dark for text to sit on. Wax glows, so it's lifted. */
const GLOW = 1.8;

function rgbOf(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  const lift = (channel: number) => Math.min(255, channel * GLOW);
  return [lift((value >> 16) & 255), lift((value >> 8) & 255), lift(value & 255)];
}

function smooth(low: number, high: number, value: number): number {
  const t = Math.min(Math.max((value - low) / (high - low), 0), 1);
  return t * t * (3 - 2 * t);
}

function paint(
  context: CanvasRenderingContext2D,
  image: ImageData,
  colors: readonly Rgb[],
  seconds: number,
  loud: number,
) {
  const aspect = WIDTH / HEIGHT;
  const placed = blobs.map(({ x, phase, speed, size, drift, color }) => ({
    x: (x + Math.sin(seconds * speed * 0.7 + phase) * drift) * aspect,
    // Up and down the whole lamp, slowly, like warm wax.
    y: 0.5 + Math.sin(seconds * speed + phase) * 0.42,
    r2: (size * (1 + loud * 0.35)) ** 2,
    rgb: colors[color] ?? colors[0] ?? ([0, 0, 0] as Rgb),
  }));
  const { data } = image;
  for (let py = 0; py < HEIGHT; py++) {
    const y = py / HEIGHT;
    for (let px = 0; px < WIDTH; px++) {
      const x = (px / WIDTH) * aspect;
      let field = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (const blob of placed) {
        const dx = x - blob.x;
        const dy = y - blob.y;
        const share = blob.r2 / (dx * dx + dy * dy + 1e-4);
        field += share;
        red += blob.rgb[0] * share;
        green += blob.rgb[1] * share;
        blue += blob.rgb[2] * share;
      }
      const at = (py * WIDTH + px) * 4;
      data[at] = red / field;
      data[at + 1] = green / field;
      data[at + 2] = blue / field;
      data[at + 3] = 255 * smooth(EDGE_LOW, EDGE_HIGH, field);
    }
  }
  context.putImageData(image, 0, 0);
}

/**
 * Wax in the album's colors, rising and sinking and running together where it meets, swelling with `loud`. Thirty
 * frames a second at a tiny size, only while it's on and the music plays.
 */
export function useLavaLamp(
  canvas: RefObject<HTMLCanvasElement | null>,
  loud: RefObject<number>,
  wash: readonly string[] | null,
  isRunning: boolean,
): void {
  // Kept across pauses, so the wax carries on from where it stopped.
  const clock = useRef(0);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d') ?? null;
    if (element === null || context === null || wash === null) return;
    const image = context.createImageData(WIDTH, HEIGHT);
    const colors = wash.map(rgbOf);
    const keepsGoing = isRunning && !prefersReducedMotion();

    let last: number | null = null;
    let frame: number | null = null;
    let wait: ReturnType<typeof setTimeout> | null = null;
    // A frame asked for on every refresh has the page run all of one, 120 times a second on a 120 Hz screen, for a lamp
    // that paints 30. So it waits until the next one is nearly due before asking.
    const draw = (now: number) => {
      frame = null;
      clock.current += last === null ? 0 : Math.min((now - last) / 1000, 0.1);
      last = now;
      paint(context, image, colors, clock.current, loud.current);
      if (!keepsGoing) return;
      wait = setTimeout(() => {
        wait = null;
        frame = requestAnimationFrame(draw);
      }, FRAME_MS - EARLY_MS);
    };
    draw(performance.now());
    return () => {
      if (wait !== null) clearTimeout(wait);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [canvas, loud, wash, isRunning]);
}
