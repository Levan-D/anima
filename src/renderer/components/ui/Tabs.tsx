import { Tabs as RadixTabs } from 'radix-ui';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

type Item = {
  value: string;
  label: string;
};

type Props = {
  /** Announced to screen readers: what these tabs switch between. */
  label: string;
  items: Item[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  children: ReactNode;
};

export function Tabs({ label, items, value, onValueChange, className, children }: Props) {
  return (
    <RadixTabs.Root value={value} onValueChange={onValueChange} className={cn('flex flex-col', className)}>
      {/* The padding cancels the tabs' own, so their text lines up with the rows below. */}
      <RadixTabs.List
        aria-label={label}
        className="flex shrink-0 flex-wrap gap-1 px-[calc(var(--spacing-gutter)-var(--spacing)*2)]"
      >
        {items.map((item) => (
          <RadixTabs.Trigger key={item.value} value={item.value} asChild>
            <Button variant="tab" size="tab">
              {item.label}
            </Button>
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      <RadixTabs.Content value={value} tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-hidden">
        {children}
      </RadixTabs.Content>
    </RadixTabs.Root>
  );
}
