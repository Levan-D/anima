import { Slider as RadixSlider } from 'radix-ui';
import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';

type Props = {
  /** Announced to screen readers: the thumb has no visible text. */
  label: string;
  value: number;
  onValueChange: (value: number) => void;
  /** Fires when the drag ends, for changes that are too expensive to send on every move. */
  onValueCommit?: (value: number) => void;
  /** Where the fill starts from, for a value that goes both ways. Below this it takes the secondary color. */
  origin?: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
};

export function Slider({ label, value, onValueChange, onValueCommit, origin, className, ...props }: Props) {
  const { min = 0, max = 100 } = props;
  const percent = (at: number) => ((at - min) / (max - min)) * 100;
  const start = origin ?? min;
  const fillFrom = `${percent(Math.min(value, start))}%`;
  const fillSize = `${Math.abs(percent(value) - percent(start))}%`;
  const fill = { '--fill-from': fillFrom, '--fill-size': fillSize } as CSSProperties;

  return (
    <RadixSlider.Root
      value={[value]}
      onValueChange={([next]) => {
        if (next !== undefined) onValueChange(next);
      }}
      onValueCommit={([next]) => {
        if (next !== undefined) onValueCommit?.(next);
      }}
      className={cn(
        'group relative flex h-tap w-full touch-none items-center select-none data-disabled:opacity-40',
        className,
      )}
      {...props}
    >
      <RadixSlider.Track className="relative h-1 grow overflow-hidden rounded-full bg-surface-active">
        {origin === undefined ? (
          <RadixSlider.Range className="absolute h-full bg-accent" />
        ) : (
          <div
            className={cn(
              'absolute left-(--fill-from) h-full w-(--fill-size)',
              value < origin ? 'bg-accent-complement' : 'bg-accent',
            )}
            style={fill}
          />
        )}
      </RadixSlider.Track>
      <RadixSlider.Thumb
        aria-label={label}
        className="block size-4 rounded-full bg-text transition-[scale] duration-(--dur-fast) ease-standard group-hover:scale-125"
      />
    </RadixSlider.Root>
  );
}
