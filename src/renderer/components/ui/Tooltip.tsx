import { Tooltip as RadixTooltip } from 'radix-ui';
import type { ComponentProps, FocusEvent, MouseEvent, PointerEvent, ReactElement } from 'react';
import { Text } from '@/components/ui/Text';
import { cn } from '@/lib/cn';

type Props = Omit<ComponentProps<typeof RadixTooltip.Trigger>, 'asChild' | 'children' | 'className'> & {
  label: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** An open tooltip takes the Escape that closes it. This is for what that Escape should do as well. */
  onEscape?: () => void;
  /** For what isn't a control: a press leaves the tooltip up, as if nothing happened. */
  staysOnPress?: boolean;
  /** For the tooltip, not the element it describes. */
  className?: string;
  /** The element it describes. It has to accept a ref and spread its props, as `<Button>` does. */
  children: ReactElement;
};

// Radix opens on any focus. After a mouse, focus handed back by a closing modal would leave this up over what's next to it.
function onlyForKeyboardFocus(event: FocusEvent<HTMLElement>): void {
  if (!event.currentTarget.matches(':focus-visible')) event.preventDefault();
}

/** Long enough that passing over a button on the way to another doesn't bring one up. */
export const TOOLTIP_DELAY_MS = 800;

export function Tooltip({
  label,
  side = 'top',
  onEscape,
  staysOnPress = false,
  className,
  children,
  ...triggerProps
}: Props) {
  const pressProps = staysOnPress
    ? {
        onPointerDown: (event: PointerEvent<HTMLButtonElement>) => event.preventDefault(),
        onClick: (event: MouseEvent<HTMLButtonElement>) => event.preventDefault(),
      }
    : {};

  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild onFocus={onlyForKeyboardFocus} {...pressProps} {...triggerProps}>
        {children}
      </RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        {/* The gap is a margin so it scales. Radix only takes a number for the padding, which just keeps it off the window's edge. */}
        <RadixTooltip.Content
          data-tooltip
          side={side}
          collisionPadding={8}
          onEscapeKeyDown={() => onEscape?.()}
          {...(staysOnPress ? { onPointerDownOutside: (event: Event) => event.preventDefault() } : {})}
          className={cn(
            'pointer-events-none z-50 max-w-110 rounded-md bg-surface-active px-3 py-1 shadow-lg no-drag',
            'data-[side=bottom]:mt-1.5 data-[side=left]:mr-1.5 data-[side=right]:ml-1.5 data-[side=top]:mb-1.5',
            'pop pop-quick origin-(--radix-tooltip-content-transform-origin)',
            className,
          )}
        >
          <Text variant="meta">{label}</Text>
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
