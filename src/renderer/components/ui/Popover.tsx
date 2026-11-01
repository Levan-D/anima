import { Popover as RadixPopover } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Props = {
  /** The button that opens it. It has to accept a ref and spread its props, as `<Button>` does. */
  trigger: ReactElement;
  /** Announced to screen readers: there's no title to name it by. */
  label: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** For the popover, not the button that opens it. */
  className?: string;
  /** For a popover whose closing means something. Leave both out and it looks after itself. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Stays open while what's outside it is used, for when that's what it's adjusting. Esc and the trigger still close it. */
  staysOpenOutside?: boolean;
  children: ReactNode;
};

/** A tap or a key away, for what a tooltip can't do: hover doesn't exist on a touch screen. */
export function Popover({
  trigger,
  label,
  side = 'top',
  align = 'end',
  className,
  open,
  onOpenChange,
  staysOpenOutside = false,
  children,
}: Props) {
  return (
    <RadixPopover.Root {...(open === undefined ? {} : { open })} {...(onOpenChange ? { onOpenChange } : {})}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        {/* The gap is a margin so it scales. Radix only takes a number for the padding, which just keeps it off the window's edge. */}
        <RadixPopover.Content
          aria-label={label}
          side={side}
          align={align}
          collisionPadding={8}
          onInteractOutside={staysOpenOutside ? (event) => event.preventDefault() : undefined}
          className={cn(
            'z-50 flex max-w-(--radix-popover-content-available-width) flex-col gap-3 rounded-lg border border-border bg-surface-raised p-gutter shadow-xl outline-hidden no-drag',
            'data-[side=bottom]:mt-1 data-[side=left]:mr-1 data-[side=right]:ml-1 data-[side=top]:mb-1',
            'pop origin-(--radix-popover-content-transform-origin)',
            className,
          )}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
