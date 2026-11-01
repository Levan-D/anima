import type { CSSProperties, ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/lib/cn';

/** How far out, in widths of the center, the wheel's middle is. A big wheel, so the arc only drops gently. */
const WHEEL_RADIUS = 3;
/** How much of the wheel's turn an item keeps, rather than staying upright. */
const TILT = 0.3;

type Stop = { out: number; scale: number; opacity: number };

// Spaced by how far out they land rather than by equal turns, so they crowd towards the edge the way a cylinder does.
const AHEAD: readonly Stop[] = [
  { out: 0.74, scale: 0.44, opacity: 0.95 },
  { out: 1.12, scale: 0.32, opacity: 0.7 },
  { out: 1.4, scale: 0.24, opacity: 0.45 },
  { out: 1.6, scale: 0.17, opacity: 0.25 },
];
const BEHIND: readonly Stop[] = [
  { out: 0.74, scale: 0.44, opacity: 0.35 },
  { out: 1.12, scale: 0.32, opacity: 0.15 },
];
const GONE: Stop = { out: 1.74, scale: 0.12, opacity: 0 };
// Behind the center and unseen, so what arrives slides under it and what leaves comes out from under it.
const CENTER: Stop = { out: 0, scale: 0.8, opacity: 0 };

function stopAt(step: number): Stop {
  if (step === 0) return CENTER;
  const stops = step > 0 ? AHEAD : BEHIND;
  return stops[Math.abs(step) - 1] ?? GONE;
}

/** The same functions every time, so the browser interpolates the angle and the item really travels along the arc. */
function placed(step: number): CSSProperties {
  const { out, scale, opacity } = stopAt(step);
  const turn = (Math.sign(step) * Math.asin(out / WHEEL_RADIUS) * 180) / Math.PI;
  const toRim = `calc(var(--barrel-size) * ${WHEEL_RADIUS})`;
  return {
    transform: `translateY(${toRim}) rotate(${turn}deg) translateY(calc(${toRim} * -1)) rotate(${turn * (TILT - 1)}deg) scale(${scale})`,
    opacity,
    zIndex: 5 - Math.abs(step),
  };
}

export type BarrelItem = {
  key: string;
  /** For the tooltip and for screen readers. */
  label: string;
  face: ReactNode;
};

type Props = {
  /** Announced to screen readers: what's on it. */
  label: string;
  items: readonly BarrelItem[];
  /** Which of them is at the center. Moving this is what turns the barrel. */
  centerIndex: number;
  /** What's shown at the center, over the item that's there. */
  center: ReactNode;
  onSelect: (item: BarrelItem) => void;
  className?: string;
};

/**
 * Items on the rim of a wheel, turning one step when the center moves. It's a CSS transition on transform and opacity, so
 * it's on the compositor and nothing runs at rest, and reduced motion is the token's 0ms. Narrow, only the neighbours show.
 */
export function Barrel({ label, items, centerIndex, center, onSelect, className }: Props) {
  return (
    <div
      role="group"
      aria-label={label}
      data-testid="barrel"
      className={cn('relative flex @container-size/barrel min-h-0 items-center justify-center overflow-hidden', className)}
    >
      <div className="relative z-10 size-(--barrel-size) shrink-0 [--barrel-size:min(92cqh,60cqw)] @2xl/barrel:[--barrel-size:min(92cqh,34cqw)]">
        {center}
      </div>
      <div className="pointer-events-none absolute inset-0 [--barrel-size:min(92cqh,60cqw)] @2xl/barrel:[--barrel-size:min(92cqh,34cqw)]">
        {items.map((item, index) => {
          const step = index - centerIndex;
          const isOut = step === 0 || stopAt(step) === GONE;
          return (
            <div
              key={item.key}
              inert={isOut}
              data-step={step}
              style={placed(step)}
              className={cn(
                'absolute top-1/2 left-1/2 -mt-[calc(var(--barrel-size)/2)] -ml-[calc(var(--barrel-size)/2)] size-(--barrel-size)',
                'transition-[transform,opacity] duration-(--dur-slow) ease-standard starting:opacity-0',
                !isOut && 'pointer-events-auto',
                Math.abs(step) > 1 && 'hidden @2xl/barrel:block',
              )}
            >
              <Tooltip label={item.label}>
                <Button
                  variant="pane"
                  size="bare"
                  aria-label={item.label}
                  onClick={() => onSelect(item)}
                  className="size-full rounded-md [&>span]:size-full"
                >
                  {item.face}
                </Button>
              </Tooltip>
            </div>
          );
        })}
      </div>
    </div>
  );
}
