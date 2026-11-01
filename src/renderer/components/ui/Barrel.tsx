import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { Tooltip } from '@/components/ui/Tooltip';
import { CENTER_ATTRIBUTE, useBarrelBrowse } from '@/hooks/useBarrelBrowse';
import { useHoverPresence } from '@/hooks/useHoverPresence';
import { cn } from '@/lib/cn';
import { pressMeansPlay } from '@/lib/press';

/** How far out, in widths of the center, the wheel's middle is. A big wheel, so the arc only drops gently. */
const WHEEL_RADIUS = 3;
/** How much of the wheel's turn an item keeps, rather than staying upright. */
const TILT = 0.3;

type Stop = { out: number; scale: number; opacity: number };

// Close enough that each tucks under the next one in, and the nearest under the center: the center's edge is at 0.5, and an
// item's reaches in by half its scale. The last just fit the wheel's width.
const PLACES = [
  { out: 0.62, scale: 0.6 },
  { out: 0.92, scale: 0.48 },
  { out: 1.12, scale: 0.38 },
  { out: 1.27, scale: 0.3 },
  { out: 1.39, scale: 0.24 },
  { out: 1.48, scale: 0.19 },
  { out: 1.54, scale: 0.15 },
] as const;
const AHEAD_OPACITY = [0.95, 0.78, 0.6, 0.45, 0.32, 0.2, 0.1];
const BEHIND_OPACITY = [0.55, 0.38, 0.26, 0.17, 0.11, 0.07, 0.04];
const AHEAD: readonly Stop[] = PLACES.map((place, index) => ({ ...place, opacity: AHEAD_OPACITY[index] ?? 0 }));
const BEHIND: readonly Stop[] = PLACES.map((place, index) => ({ ...place, opacity: BEHIND_OPACITY[index] ?? 0 }));
const GONE: Stop = { out: 1.6, scale: 0.12, opacity: 0 };
/** A pulled-out record, as from a crate: forward and up, over everything. */
const PULL_LIFT = -0.14;
const PULL_GROWTH = 1.3;
// Behind the center and unseen, so what arrives slides under it and what leaves comes out from under it.
const CENTER: Stop = { out: 0, scale: 0.8, opacity: 0 };
// Turned to by hand, it takes the center's place while what's live waits on the rim.
const BROWSED_CENTER: Stop = { out: 0, scale: 1, opacity: 1 };

function stopAt(step: number, isBrowsing: boolean): Stop {
  if (step === 0) return isBrowsing ? BROWSED_CENTER : CENTER;
  // Browsing, the past is as much there to look at as what's ahead.
  const stops = step > 0 || isBrowsing ? AHEAD : BEHIND;
  return stops[Math.abs(step) - 1] ?? GONE;
}

/** The same functions every time, so the browser interpolates the angle and the item really travels along the arc. */
function placed(step: number, isBrowsing: boolean, isSelected: boolean): CSSProperties {
  const stop = stopAt(step, isBrowsing);
  const isPulled = isSelected && step !== 0 && stop !== GONE;
  const { out } = stop;
  const scale = isPulled ? stop.scale * PULL_GROWTH : stop.scale;
  const turn = (Math.sign(step) * Math.asin(out / WHEEL_RADIUS) * 180) / Math.PI;
  const toRim = `calc(var(--barrel-size) * ${WHEEL_RADIUS})`;
  return {
    transform: `translateY(calc(var(--barrel-size) * ${isPulled ? PULL_LIFT : 0})) translateY(${toRim}) rotate(${turn}deg) translateY(calc(${toRim} * -1)) rotate(${turn * (TILT - 1)}deg) scale(${scale})`,
    // Opaque, as sleeves are: the card's own scrim is what dims it. These two are for arriving and leaving.
    opacity: stop === GONE || stop === CENTER ? 0 : 1,
    '--barrel-dim': isPulled ? 0 : 1 - stop.opacity,
    zIndex: isPulled ? 20 : 8 - Math.abs(step),
  } as CSSProperties;
}

// In a query on the wheel, so it can only be set inside it.
const SIZED = '[--barrel-size:min(83cqh,54cqw)] @2xl/barrel:[--barrel-size:min(83cqh,31cqw)]';

export type BarrelItem = {
  key: string;
  /** For the tooltip, the line under the wheel, and screen readers. */
  label: string;
  face: ReactNode;
  /** Slides out from behind the face on hover and focus, and only exists then. */
  behind?: ReactNode;
};

type CardProps = {
  item: BarrelItem;
  isSelected: boolean;
  side: -1 | 1;
  onPress: (event: MouseEvent) => void;
};

function BarrelCard({ item, isSelected, side, onPress }: CardProps) {
  const { isPresent, triggerProps } = useHoverPresence();
  return (
    <Tooltip label={item.label}>
      <Button
        variant="card"
        size="bare"
        aria-label={item.label}
        aria-pressed={isSelected}
        style={{ '--disc-side': side } as CSSProperties}
        onDragStart={(event) => event.preventDefault()}
        onClick={onPress}
        className="size-full [&>span]:size-full"
        {...triggerProps}
      >
        {isPresent ? item.behind : null}
        {item.face}
        <span className="pointer-events-none absolute inset-0 z-1 rounded-sm bg-bg opacity-(--barrel-dim) transition-opacity duration-(--dur-fast) ease-standard group-hover:opacity-0" />
      </Button>
    </Tooltip>
  );
}

type Props = {
  /** Announced to screen readers: what's on it. */
  label: string;
  items: readonly BarrelItem[];
  /** Which of them is live, at the center. Moving this is what turns the barrel. */
  centerIndex: number;
  /** What's shown at the center, over the item that's there. */
  center: ReactNode;
  onPlay: (item: BarrelItem) => void;
  /** How long after the last touch it glides back to the live item. */
  returnAfterMs: number;
  className?: string;
};

/**
 * Items on the rim of a wheel, overlapping like a stack, turning a step when the center moves. A wheel, a drag or the arrow
 * keys spin it by hand for a while. One click pulls a record out, another puts it back, and two play it; a tap or a key press plays. It's a
 * CSS transition on transform and opacity, so it's on the compositor and nothing runs at rest, and reduced motion is the
 * token's 0ms. Narrow, only the neighbours show.
 */
export function Barrel({ label, items, centerIndex: liveIndex, center, onPlay, returnAfterMs, className }: Props) {
  const keys = items.map(({ key }) => key);
  const { centerIndex, isBrowsing, selectedKey, toggleSelected, goLive, areaRef, areaProps } = useBarrelBrowse({
    keys,
    liveIndex,
    returnAfterMs,
  });
  const selected = items.find(({ key }) => key === selectedKey) ?? null;
  const caption = selected ?? (isBrowsing ? (items[centerIndex] ?? null) : null);

  return (
    <div role="group" aria-label={label} data-testid="barrel" className={cn('flex min-h-0 flex-col', className)}>
      <div
        ref={areaRef}
        {...areaProps}
        className="relative flex @container-size/barrel min-h-0 flex-1 touch-pan-y items-center justify-center overflow-hidden select-none"
      >
        <div
          {...{ [CENTER_ATTRIBUTE]: true }}
          inert={isBrowsing}
          className={cn(
            'relative z-10 size-(--barrel-size) shrink-0 transition-opacity duration-(--dur-mid) ease-standard',
            SIZED,
            isBrowsing && 'opacity-0',
          )}
        >
          {center}
        </div>
        <div className={cn('pointer-events-none absolute inset-0', SIZED)}>
          {items.map((item, index) => {
            const step = index - centerIndex;
            const isOut = (step === 0 && !isBrowsing) || stopAt(step, isBrowsing) === GONE;
            const isSelected = item.key === selectedKey;
            return (
              <div
                key={item.key}
                inert={isOut}
                data-step={step}
                style={placed(step, isBrowsing, isSelected)}
                className={cn(
                  'absolute top-1/2 left-1/2 -mt-[calc(var(--barrel-size)/2)] -ml-[calc(var(--barrel-size)/2)] size-(--barrel-size)',
                  'transition-[transform,opacity] ease-standard starting:opacity-0',
                  isBrowsing ? 'duration-(--dur-mid)' : 'duration-(--dur-slow)',
                  !isOut && 'pointer-events-auto',
                  Math.abs(step) > 1 && 'hidden @2xl/barrel:block',
                )}
              >
                <BarrelCard
                  item={item}
                  isSelected={isSelected}
                  side={step < 0 ? -1 : 1}
                  onPress={(event) => {
                    if (pressMeansPlay(event)) {
                      goLive();
                      onPlay(item);
                    } else {
                      toggleSelected(item.key);
                    }
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex min-h-lh shrink-0 justify-center px-gutter">
        <Text color="muted" truncate data-testid="barrel-caption">
          {caption?.label ?? ''}
        </Text>
      </div>
    </div>
  );
}
