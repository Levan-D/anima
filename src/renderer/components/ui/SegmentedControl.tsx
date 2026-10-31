import { ToggleGroup } from 'radix-ui';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

type Item<Value extends string> = {
  value: Value;
  label: string;
};

type Size = 'sm' | 'md';

// As tall as a button of that size, the frame included.
const groupClasses: Record<Size, string> = {
  sm: 'h-8 gap-0.5 p-0.5',
  md: 'h-10 gap-1 p-1',
};

type Props<Value extends string> = {
  /** Announced to screen readers: what these choose between. */
  label: string;
  items: readonly Item<Value>[];
  value: Value;
  onValueChange: (value: Value) => void;
  size?: Size;
  className?: string;
};

/** One of a few, all in view. Pressing the one that's on leaves it on: Radix would otherwise turn it off and send nothing. */
export function SegmentedControl<Value extends string>({
  label,
  items,
  value,
  onValueChange,
  size = 'md',
  className,
}: Props<Value>) {
  function choose(next: string): void {
    const item = items.find((candidate) => candidate.value === next);
    if (item) onValueChange(item.value);
  }

  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      value={value}
      onValueChange={choose}
      className={cn('flex w-fit rounded-lg border border-divider bg-surface-raised', groupClasses[size], className)}
    >
      {items.map((item) => (
        <ToggleGroup.Item key={item.value} value={item.value} asChild>
          <Button variant="segment" size={size} className="h-full">
            {item.label}
          </Button>
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
