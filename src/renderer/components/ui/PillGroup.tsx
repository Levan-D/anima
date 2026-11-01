import { ToggleGroup } from 'radix-ui';
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
  /** At most this many, and they scroll sideways together when they don't fit. */
  rows?: number;
  className?: string;
};

const SPACE_AROUND_A_PILL = 6;

function lengthOf({ label, count }: PillItem): number {
  return label.length + String(count ?? '').length + SPACE_AROUND_A_PILL;
}

/** In their order, with each row about as long as the others, so the block scrolls as one. */
export function pillRows(items: readonly PillItem[], rows: number): PillItem[][] {
  const target = items.reduce((sum, item) => sum + lengthOf(item), 0) / rows;
  const result: PillItem[][] = [[]];
  let length = 0;
  for (const item of items) {
    if (length >= target && result.length < rows) {
      result.push([]);
      length = 0;
    }
    result.at(-1)?.push(item);
    length += lengthOf(item);
  }
  return result;
}

/** Any number of pills on. */
export function PillGroup({ label, items, value, onValueChange, rows = 4, className }: Props) {
  const stripRef = useTabStrip<HTMLDivElement>('');

  return (
    <div ref={stripRef} className={cn('w-full min-w-0 shrink-0 overflow-x-auto overflow-y-hidden', className)}>
      <Text as="div" variant="meta" color="inherit">
        <ToggleGroup.Root
          type="multiple"
          aria-label={label}
          value={[...value]}
          onValueChange={onValueChange}
          className="flex w-max min-w-full flex-col gap-1.5"
        >
          {pillRows(items, rows).map((row) => (
            <div key={row[0]?.value ?? ''} className="flex gap-1.5">
              {row.map((item) => (
                <ToggleGroup.Item key={item.value} value={item.value} asChild>
                  <Pill count={item.count}>{item.label}</Pill>
                </ToggleGroup.Item>
              ))}
            </div>
          ))}
        </ToggleGroup.Root>
      </Text>
    </div>
  );
}
