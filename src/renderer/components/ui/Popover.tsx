import { Popover as RadixPopover } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { EDGE_CLEARANCE, popoverClasses } from '@/components/ui/popper';

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
        <RadixPopover.Content
          aria-label={label}
          side={side}
          align={align}
          collisionPadding={EDGE_CLEARANCE}
          onInteractOutside={staysOpenOutside ? (event) => event.preventDefault() : undefined}
          className={cn(...popoverClasses, className)}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
