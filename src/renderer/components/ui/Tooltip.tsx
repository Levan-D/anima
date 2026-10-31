import { Tooltip as RadixTooltip } from 'radix-ui';
import type { ComponentProps, FocusEvent, ReactElement } from 'react';
import { Text } from '@/components/ui/Text';
import { cn } from '@/lib/cn';

type Props = Omit<ComponentProps<typeof RadixTooltip.Trigger>, 'asChild' | 'children' | 'className'> & {
  label: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** An open tooltip takes the Escape that closes it. This is for what that Escape should do as well. */
  onEscape?: () => void;
  /** For the tooltip, not the element it describes. */
  className?: string;
  /** The element it describes. It has to accept a ref and spread its props, as `<Button>` does. */
  children: ReactElement;
};

// Radix opens on any focus. After a mouse, focus handed back by a closing modal would leave this up over what's next to it.
function onlyForKeyboardFocus(event: FocusEvent<HTMLElement>): void {
  if (!event.currentTarget.matches(':focus-visible')) event.preventDefault();
}

export function Tooltip({ label, side = 'top', onEscape, className, children, ...triggerProps }: Props) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild onFocus={onlyForKeyboardFocus} {...triggerProps}>
        {children}
      </RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        {/* The gap is a margin so it scales. Radix only takes a number for the padding, which just keeps it off the window's edge. */}
        <RadixTooltip.Content
          side={side}
          collisionPadding={8}
          onEscapeKeyDown={() => onEscape?.()}
          className={cn(
            'z-50 rounded-md bg-surface-active px-3 py-1 shadow-lg no-drag',
            'data-[side=bottom]:mt-1.5 data-[side=left]:mr-1.5 data-[side=right]:ml-1.5 data-[side=top]:mb-1.5',
            'data-[state=closed]:animate-fade-out data-[state=delayed-open]:animate-fade-rise',
            className,
          )}
        >
          <Text variant="meta">{label}</Text>
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
