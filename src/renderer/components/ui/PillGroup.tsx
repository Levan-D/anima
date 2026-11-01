import { ToggleGroup } from 'radix-ui';
import type { CSSProperties } from 'react';
import { Pill } from '@/components/ui/Pill';
import { Text } from '@/components/ui/Text';
import { useTabStrip } from '@/hooks/useTabStrip';
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

// In em of the pills' own type, a bit over what they take, since wrapping leaves the end of a line unused.
const EM_PER_CHARACTER = 0.6;
const EM_AROUND_A_PILL = 3;
const WRAP_ROOM = 1.15;
const LINES = 2;

function twoLinesWide(items: readonly PillItem[]): string {
  const characters = items.reduce((sum, { label, count }) => sum + label.length + String(count ?? '').length, 0);
  const total = characters * EM_PER_CHARACTER + items.length * EM_AROUND_A_PILL;
  return `${Math.ceil((total / LINES) * WRAP_ROOM)}em`;
}

/**
 * Any number of pills on. They wrap to two lines and then scroll sideways: the inner box is at least wide enough to hold
 * them all in two lines, which CSS can do alone since the width comes from the text and not from a measurement.
 */
export function PillGroup({ label, items, value, onValueChange, className }: Props) {
  const stripRef = useTabStrip<HTMLDivElement>('');
  const style = { '--pills-width': twoLinesWide(items) } as CSSProperties;

  return (
    <div
      ref={stripRef}
      className={cn('min-w-0 [scrollbar-width:none] overflow-x-auto overflow-y-hidden p-0.5', className)}
    >
      <Text as="div" variant="meta" color="inherit">
        <ToggleGroup.Root
          type="multiple"
          aria-label={label}
          value={[...value]}
          onValueChange={onValueChange}
          style={style}
          className="flex w-[max(100%,var(--pills-width))] flex-wrap gap-1.5"
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
