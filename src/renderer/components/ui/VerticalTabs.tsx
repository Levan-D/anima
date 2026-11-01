import { Tabs as RadixTabs } from 'radix-ui';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { useTabStrip } from '@/hooks/useTabStrip';
import { cn } from '@/lib/cn';

export type VerticalTab = {
  value: string;
  label: string;
  /** Mounted only while its tab is the active one. */
  content: ReactNode;
};

type Props = {
  /** Announced to screen readers: what these tabs switch between. */
  label: string;
  items: VerticalTab[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
};

// A mouse press would otherwise light up a ring, as in Tabs. Stopping that also stops Radix choosing the tab, so a click does.
function keepMouseFromFocusing(event: MouseEvent): void {
  event.preventDefault();
}

// Radix goes up and down, because that's what the column is. Along the top in a small space, the other two arrows are the
// ones anyone would reach for. Focusing a tab chooses it.
function moveAcross(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  const tabs = [...(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
  const step = event.key === 'ArrowRight' ? 1 : -1;
  tabs[(tabs.indexOf(event.currentTarget) + step + tabs.length) % tabs.length]?.focus();
}

/**
 * A column of tabs on the left with the content beside it, each pane scrolling by itself. In a small space the column goes
 * along the top: that's by the width this has, in CSS, and the tabs then scroll sideways.
 */
export function VerticalTabs({ label, items, value, onValueChange, className }: Props) {
  const stripRef = useTabStrip<HTMLDivElement>(value);

  return (
    <RadixTabs.Root
      orientation="vertical"
      value={value}
      onValueChange={onValueChange}
      className={cn('@container flex min-h-0 w-full flex-1 flex-col', className)}
    >
      <div className="flex min-h-0 flex-1 flex-col @side-tabs:flex-row">
        <RadixTabs.List
          ref={stripRef}
          aria-label={label}
          className="flex shrink-0 [scrollbar-width:none] gap-1 overflow-x-auto px-gutter py-1 @side-tabs:w-60 @side-tabs:flex-col @side-tabs:overflow-x-hidden @side-tabs:overflow-y-auto @side-tabs:py-section"
        >
          {items.map((item) => (
            <RadixTabs.Trigger
              key={item.value}
              value={item.value}
              onMouseDown={keepMouseFromFocusing}
              onKeyDown={moveAcross}
              asChild
            >
              <Button
                variant="side-tab"
                size="tab"
                className="shrink-0"
                onClick={(event) => {
                  // So the arrows carry on from here, and any ring goes with the tab that's showing.
                  event.currentTarget.focus();
                  if (item.value !== value) onValueChange(item.value);
                }}
              >
                {item.label}
              </Button>
            </RadixTabs.Trigger>
          ))}
        </RadixTabs.List>
        <Divider className="@side-tabs:hidden" />
        <Divider orientation="vertical" className="hidden @side-tabs:block" />
        {items.map((item) => (
          <RadixTabs.Content
            key={item.value}
            value={item.value}
            className="flex min-h-0 min-w-0 flex-1 scrollbar-stable flex-col overflow-y-auto px-section focus-inset data-[state=inactive]:hidden"
          >
            {item.content}
          </RadixTabs.Content>
        ))}
      </div>
    </RadixTabs.Root>
  );
}
