import { useMovingBars } from '@/components/music/useMovingBars';

const BARS = [0, 1, 2];

/** Three small bars that move while it plays, and hold still when it doesn't. */
export function PlayingBars() {
  const barsRef = useMovingBars();

  return (
    <span ref={barsRef} aria-hidden data-testid="playing-bars" className="flex h-4 items-end justify-center gap-0.5">
      {BARS.map((bar) => (
        <span key={bar} className="h-full w-1 origin-bottom [transform:scaleY(0.6)] rounded-t-sm bg-accent" />
      ))}
    </span>
  );
}
