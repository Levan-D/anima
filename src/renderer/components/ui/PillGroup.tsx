import { ToggleGroup } from 'radix-ui';
import { Pill } from '@/components/ui/Pill';
import { Text } from '@/components/ui/Text';
import { cn } from '@/lib/cn';

export type PillItem = {
  value: string;
  label: string;
  count?: number | undefined;
};

type Props = {
  /** Announced to screen readers: what these choose between. */
  label: string;
  items: readonly PillItem[];
  value: readonly string[];
  onValueChange: (value: string[]) => void;
  className?: string;
};

/**
 * Any number of pills on. They wrap, and take the height they need.
 */
export function PillGroup({ label, items, value, onValueChange, className }: Props) {
  return (
    <div className={cn('min-w-0 shrink-0 p-0.5', className)}>
      <Text as="div" variant="meta" color="inherit">
        <ToggleGroup.Root
          type="multiple"
          aria-label={label}
          value={[...value]}
          onValueChange={onValueChange}
          className="flex flex-wrap gap-1.5"
        >
          {items.map((item) => (
            <ToggleGroup.Item key={item.value} value={item.value} asChild>
              <Pill count={item.count}>{item.label}</Pill>
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
      </Text>
    </div>
  );
}
