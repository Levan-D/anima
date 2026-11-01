import { Tabs as RadixTabs } from 'radix-ui';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { useTabStrip } from '@/hooks/useTabStrip';
import { cn } from '@/lib/cn';

type Item = {
  value: string;
  label: string;
};

type Props = {
  /** Announced to screen readers: what these tabs switch between. */
  label: string;
  items: Item[];
  /** An empty string means none of them is showing. */
  value: string;
  onValueChange: (value: string) => void;
  /** The tab that's already active was pressed. */
  onReselect?: (value: string) => void;
  /** Arrow Down on a tab: a way into what the tabs are showing. */
  onArrowDown?: () => void;
  /** Shares the tabs' row, at its right. It should give up its width before they do. */
  beside?: ReactNode;
  className?: string;
  children: ReactNode;
};

// Radix focuses the trigger from script on mousedown, and the browser shows a ring for script focus unless the last
// focus came from the mouse. So the first tab anyone clicks would light up, and stay lit for every tab after it.
// Stopping that also stops Radix choosing the tab, so a click does it instead.
function keepMouseFromFocusing(event: MouseEvent): void {
  event.preventDefault();
}

export function Tabs({
  label,
  items,
  value,
  onValueChange,
  onReselect,
  onArrowDown,
  beside,
  className,
  children,
}: Props) {
  const stripRef = useTabStrip<HTMLDivElement>(value);

  function onTabKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' || !onArrowDown) return;
    event.preventDefault();
    onArrowDown();
  }

  return (
    // Manual: a keyboard passing through the tabs on its way to the list shouldn't change what the list shows.
    <RadixTabs.Root
      value={value}
      onValueChange={onValueChange}
      activationMode="manual"
      className={cn('flex flex-col', className)}
    >
      <div className="flex shrink-0 items-center">
        {/*
         * The padding cancels the first tab's own, so its text lines up with the rows below. They never wrap: another row
         * would come out of the list, so they scroll sideways, which clips outward focus rings, so theirs are inset.
         */}
        <RadixTabs.List
          ref={stripRef}
          aria-label={label}
          className="flex max-w-full min-w-0 [scrollbar-width:none] gap-1 overflow-x-auto pl-[calc(var(--spacing-gutter)-var(--spacing)*2)]"
        >
          {items.map((item) => (
            <RadixTabs.Trigger
              key={item.value}
              value={item.value}
              onMouseDown={keepMouseFromFocusing}
              onKeyDown={onTabKeyDown}
              asChild
            >
              <Button
                variant="tab"
                size="tab"
                onClick={() => {
                  if (item.value === value) onReselect?.(item.value);
                  else onValueChange(item.value);
                }}
              >
                {item.label}
              </Button>
            </RadixTabs.Trigger>
          ))}
        </RadixTabs.List>
        {beside}
      </div>
      <RadixTabs.Content
        value={value}
        tabIndex={-1}
        aria-label={label}
        className="relative flex min-h-0 flex-1 flex-col outline-hidden"
      >
        {children}
      </RadixTabs.Content>
    </RadixTabs.Root>
  );
}
