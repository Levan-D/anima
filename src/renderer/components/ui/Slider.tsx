import { Slider as RadixSlider } from 'radix-ui';
import { cn } from '@/lib/cn';

type Props = {
  /** Announced to screen readers: the thumb has no visible text. */
  label: string;
  value: number;
  onValueChange: (value: number) => void;
  /** Fires when the drag ends, for changes that are too expensive to send on every move. */
  onValueCommit?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
};

export function Slider({ label, value, onValueChange, onValueCommit, className, ...props }: Props) {
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
        <RadixSlider.Range className="absolute h-full bg-accent" />
      </RadixSlider.Track>
      <RadixSlider.Thumb
        aria-label={label}
        className="block size-4 rounded-full bg-text transition-[scale] duration-(--dur-fast) ease-standard group-hover:scale-125"
      />
    </RadixSlider.Root>
  );
}
