import { cn } from '@/lib/cn';
import { usePlayer } from '@/lib/playerStore';

const BARS = ['animate-bar-a', 'animate-bar-b', 'animate-bar-c'];

/**
 * Three small bars that grow and shrink on the compositor while it plays, and hold still when it doesn't. Each has its
 * own keyframes, length and offset, so they don't look like a loop. A hidden window pauses them through the root.
 */
export function PlayingBars() {
  const isPlaying = usePlayer((state) => state.status === 'playing');

  return (
    <span aria-hidden data-testid="playing-bars" className="flex h-4 items-end justify-center gap-0.5">
      {BARS.map((animation) => (
        <span
          key={animation}
          className={cn(
            'h-full w-1 origin-bottom [transform:scaleY(0.6)] rounded-t-sm bg-accent motion-reduce:animate-none',
            animation,
            !isPlaying && '[animation-play-state:paused]',
          )}
        />
      ))}
    </span>
  );
}
