import { Popover as RadixPopover } from 'radix-ui';
import {
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';
import { isMousePress } from '@/lib/press';

const OPEN_DELAY_MS = 200;
const CLOSE_DELAY_MS = 140;

type Props = {
  /** What it's about. It has to accept a ref and spread its props, as `<Button>` does. */
  trigger: ReactElement;
  /** Announced to screen readers: there's no title to name it by. */
  label: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** For the card, not what opens it. */
  className?: string;
  /** Rendered only while it's open. */
  children: ReactNode;
};

/**
 * More about something, on hover, keyboard focus or a tap. Pressing Enter on what opens it moves focus into the card.
 *
 * Radix's Popover and not its HoverCard: that one takes everything in it out of the tab order and can't take focus from a
 * modal's trap, so a keyboard could never reach a link in it.
 */
export function HoverCard({ trigger, label, side = 'top', align = 'end', className, children }: Props) {
  const [isOpen, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const anchorRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const givesFocusBack = useRef(false);

  function setOpenAfter(next: boolean, delay: number): void {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(next), delay);
  }

  function openNow(next: boolean): void {
    clearTimeout(timer.current);
    setOpen(next);
  }

  function onHover(event: PointerEvent): void {
    if (event.pointerType === 'mouse') setOpenAfter(true, OPEN_DELAY_MS);
  }

  function onHoverEnd(event: PointerEvent): void {
    if (event.pointerType !== 'mouse') return;
    if (contentRef.current?.querySelector(':focus-visible')) return;
    setOpenAfter(false, CLOSE_DELAY_MS);
  }

  // After a mouse, focus handed back by something closing would leave this up over what's next to it.
  function onFocus(event: FocusEvent<HTMLElement>): void {
    if (givesFocusBack.current) givesFocusBack.current = false;
    else if (event.currentTarget.matches(':focus-visible')) openNow(true);
  }

  function onBlur(event: FocusEvent): void {
    if (!(event.relatedTarget instanceof Node && contentRef.current?.contains(event.relatedTarget))) {
      setOpenAfter(false, CLOSE_DELAY_MS);
    }
  }

  function onPress(event: MouseEvent): void {
    if (isMousePress(event)) {
      openNow(true);
    } else if (event.detail === 0) {
      openNow(true);
      const first = contentRef.current?.querySelector<HTMLElement>('a[href], button:not([disabled])');
      (first ?? contentRef.current)?.focus();
    } else {
      openNow(!isOpen);
    }
  }

  function keepOpenForTrigger(event: { target: EventTarget | null; preventDefault: () => void }): void {
    if (event.target instanceof Node && anchorRef.current?.contains(event.target)) event.preventDefault();
  }

  return (
    <RadixPopover.Root open={isOpen} onOpenChange={openNow}>
      <RadixPopover.Anchor
        ref={anchorRef}
        asChild
        onPointerEnter={onHover}
        onPointerLeave={onHoverEnd}
        onFocus={onFocus}
        onBlur={onBlur}
        onClick={onPress}
      >
        {trigger}
      </RadixPopover.Anchor>
      <RadixPopover.Portal>
        {/* The gap is a margin so it scales. Radix only takes a number for the padding, which just keeps it off the window's edge. */}
        <RadixPopover.Content
          ref={contentRef}
          aria-label={label}
          side={side}
          align={align}
          collisionPadding={8}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (givesFocusBack.current) anchorRef.current?.focus();
          }}
          onEscapeKeyDown={() => {
            givesFocusBack.current = contentRef.current?.contains(document.activeElement) ?? false;
          }}
          onInteractOutside={keepOpenForTrigger}
          onPointerEnter={() => clearTimeout(timer.current)}
          onPointerLeave={onHoverEnd}
          onFocus={() => clearTimeout(timer.current)}
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
