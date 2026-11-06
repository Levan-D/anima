import { ToggleGroup } from 'radix-ui';
import { Pill } from '@/components/ui/Pill';
import { ScrollArrows } from '@/components/ui/ScrollArrows';
import { Text } from '@/components/ui/Text';
import { useScrollEnds } from '@/hooks/useScrollEnds';
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
  /** A second set beside the first, in another color. */
  isSecondary?: boolean;
  /** Set in by the page's gutter, inside what scrolls, so the pills scroll out to the window's edge. */
  isInset?: boolean;
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
export function PillGroup({
  label,
  items,
  value,
  onValueChange,
  rows = 4,
  isSecondary = false,
  isInset = false,
  className,
}: Props) {
  const stripRef = useTabStrip<HTMLDivElement>('');
  const { canGoBack, canGoForward, page } = useScrollEnds(stripRef);
  const pills = (row: readonly PillItem[]) =>
    row.map((item) => (
      <ToggleGroup.Item key={item.value} value={item.value} asChild>
        <Pill count={item.count} isSecondary={isSecondary}>
          {item.label}
        </Pill>
      </ToggleGroup.Item>
    ));

  return (
    <div className={cn('group/scroller relative w-full min-w-0 shrink-0', className)}>
      <div
        ref={stripRef}
        className={cn(
          '[scrollbar-width:none] overflow-x-auto overflow-y-hidden',
          isInset && 'scroll-px-gutter px-gutter',
        )}
      >
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
                {pills(row)}
              </div>
            ))}
          </ToggleGroup.Root>
        </Text>
      </div>
      <ScrollArrows canGoBack={canGoBack} canGoForward={canGoForward} onPage={page} />
    </div>
  );
}
