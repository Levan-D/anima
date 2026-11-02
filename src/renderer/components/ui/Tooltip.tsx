import { Tooltip as RadixTooltip } from 'radix-ui';
import { useState, type ComponentProps, type FocusEvent, type MouseEvent, type ReactElement } from 'react';
import { Text } from '@/components/ui/Text';
import { cn } from '@/lib/cn';

type Props = Omit<ComponentProps<typeof RadixTooltip.Trigger>, 'asChild' | 'children' | 'className'> & {
  label: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** An open tooltip takes the Escape that closes it. This is for what that Escape should do as well. */
  onEscape?: () => void;
  /** For what explains something: it comes up sooner, and a tap opens it, since there's no hover on a touch screen. */
  opensOnTap?: boolean;
  /** For the tooltip, not the element it describes. */
  className?: string;
  /** The element it describes. It has to accept a ref and spread its props, as `<Button>` does. */
  children: ReactElement;
};

// Radix opens on any focus. After a mouse, focus handed back by a closing modal would leave this up over what's next to it.
function onlyForKeyboardFocus(event: FocusEvent<HTMLElement>): void {
  if (!event.currentTarget.matches(':focus-visible')) event.preventDefault();
}

const TAP_TOOLTIP_DELAY_MS = 200;
/** Long enough that passing over a button on the way to another doesn't bring one up. */
export const TOOLTIP_DELAY_MS = 800;

export function Tooltip({
  label,
  side = 'top',
  onEscape,
  opensOnTap = false,
  className,
  children,
  ...triggerProps
}: Props) {
  const [isOpen, setOpen] = useState(false);
  const rootProps = opensOnTap ? { open: isOpen, onOpenChange: setOpen, delayDuration: TAP_TOOLTIP_DELAY_MS } : {};
  // Radix closes on any click, unless the click's default has been prevented first.
  const tapProps = opensOnTap
    ? {
        onClick: (event: MouseEvent<HTMLButtonElement>) => {
          event.preventDefault();
          setOpen(true);
        },
      }
    : {};

  return (
    <RadixTooltip.Root {...rootProps}>
      <RadixTooltip.Trigger asChild onFocus={onlyForKeyboardFocus} {...tapProps} {...triggerProps}>
        {children}
      </RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        {/* The gap is a margin so it scales. Radix only takes a number for the padding, which just keeps it off the window's edge. */}
        <RadixTooltip.Content
          side={side}
          collisionPadding={8}
          onEscapeKeyDown={() => onEscape?.()}
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
