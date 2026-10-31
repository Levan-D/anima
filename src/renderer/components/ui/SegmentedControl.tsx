import { ToggleGroup } from 'radix-ui';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

type Item<Value extends string> = {
  value: Value;
  label: string;
};

type Props<Value extends string> = {
  /** Announced to screen readers: what these choose between. */
  label: string;
  items: readonly Item<Value>[];
  value: Value;
  onValueChange: (value: Value) => void;
  className?: string;
};

/** One of a few, all in view. Pressing the one that's on leaves it on: Radix would otherwise turn it off and send nothing. */
export function SegmentedControl<Value extends string>({
  label,
  items,
  value,
  onValueChange,
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
      className={cn('flex w-fit gap-1 rounded-lg bg-surface-raised p-1', className)}
    >
      {items.map((item) => (
        <ToggleGroup.Item key={item.value} value={item.value} asChild>
          <Button variant="segment" size="sm">
            {item.label}
          </Button>
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
