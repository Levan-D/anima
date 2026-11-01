import type { LucideIcon } from 'lucide-react';
import { Popover as RadixPopover } from 'radix-ui';
import {
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type WheelEvent,
} from 'react';
import { Button } from '@/components/ui/Button';
import { IconSwap } from '@/components/ui/IconSwap';
import { cn } from '@/lib/cn';
import { isMousePress } from '@/lib/press';

const OPEN_DELAY_MS = 120;
const CLOSE_GRACE_MS = 250;

type Props = {
  /** Each is the button's name in that state. */
  labelOff: string;
  labelOn: string;
  isOn: boolean;
  onPressedChange: (next: boolean) => void;
  icon: LucideIcon;
  iconOn: LucideIcon;
  /** Announced to screen readers: the bar has no title to name it by. */
  barLabel: string;
  side?: 'top' | 'left';
  /** One notch of the wheel over the button or the bar. */
  onStep: (direction: 1 | -1) => void;
  /** For the button. */
  className?: string;
  /** The slider. */
  children: ReactNode;
};

function focusKeepsItOpen(element: HTMLElement | null): boolean {
  return element !== null && (element.matches(':focus-visible') || element.querySelector(':focus-visible') !== null);
}

/**
 * An icon that toggles, with a slider that shows while the pointer or keyboard focus is on it. A finger has no hover, so a
 * tap opens the bar instead, and the toggle comes along in it. Tab goes from the button into the bar.
 *
 * In a portal because what it's in may be covered by what's above it, and it's to show over that.
 */
export function HoverSlider({
  labelOff,
  labelOn,
  isOn,
  onPressedChange,
  icon: Icon,
  iconOn: IconOn,
  barLabel,
  side = 'top',
  onStep,
  className,
  children,
}: Props) {
  const [isOpen, setOpen] = useState(false);
  const [openedByTouch, setOpenedByTouch] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const isHovered = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const givesFocusBack = useRef(false);
  const label = isOn ? labelOn : labelOff;

  function openNow(next: boolean): void {
    clearTimeout(timer.current);
    setOpen(next);
    if (next) return;
    setOpenedByTouch(false);
    // Gone from under the pointer, which then never gets to say it left.
    isHovered.current = false;
  }

  function closeIfLeft(): void {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const isHeld = isHovered.current || focusKeepsItOpen(buttonRef.current) || focusKeepsItOpen(barRef.current);
      if (!isHeld) openNow(false);
    }, CLOSE_GRACE_MS);
  }

  function onHover(event: PointerEvent): void {
    if (event.pointerType !== 'mouse') return;
    isHovered.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), OPEN_DELAY_MS);
  }

  function onHoverEnd(event: PointerEvent): void {
    if (event.pointerType !== 'mouse') return;
    isHovered.current = false;
    closeIfLeft();
  }

  function onButtonFocus(event: FocusEvent<HTMLElement>): void {
    if (givesFocusBack.current) givesFocusBack.current = false;
    else if (event.currentTarget.matches(':focus-visible')) openNow(true);
  }

  function onButtonBlur(event: FocusEvent): void {
    if (!(event.relatedTarget instanceof Node && barRef.current?.contains(event.relatedTarget))) closeIfLeft();
  }

  function onPress(event: MouseEvent): void {
    // A key press has no pointer and no click count, and means the same as a mouse.
    if (isMousePress(event) || event.detail === 0) {
      onPressedChange(!isOn);
      return;
    }
    setOpenedByTouch(!isOpen);
    openNow(!isOpen);
  }

  function onButtonKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || event.shiftKey || !isOpen) return;
    event.preventDefault();
    barRef.current?.querySelector<HTMLElement>('[role="slider"]')?.focus();
  }

  // The portal is at the end of the document, which is not where Tab should go from here.
  function onBarKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    givesFocusBack.current = true;
    buttonRef.current?.focus();
    if (event.shiftKey) event.preventDefault();
  }

  function onWheel({ deltaY }: WheelEvent): void {
    if (deltaY !== 0) onStep(deltaY < 0 ? 1 : -1);
  }

  function keepOpenForButton(event: { target: EventTarget | null; preventDefault: () => void }): void {
    if (event.target instanceof Node && buttonRef.current?.contains(event.target)) event.preventDefault();
  }

  return (
    <RadixPopover.Root open={isOpen} onOpenChange={openNow}>
      <RadixPopover.Anchor asChild>
        <Button
          ref={buttonRef}
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-pressed={isOn}
          onPointerEnter={onHover}
          onPointerLeave={onHoverEnd}
          onFocus={onButtonFocus}
          onBlur={onButtonBlur}
          onClick={onPress}
          onKeyDown={onButtonKeyDown}
          onWheel={onWheel}
          className={cn(isOn && 'text-accent hover:text-accent', className)}
        >
          <IconSwap id={String(isOn)}>{isOn ? <IconOn aria-hidden /> : <Icon aria-hidden />}</IconSwap>
        </Button>
      </RadixPopover.Anchor>
      <RadixPopover.Portal>
        {/* The gap is a margin so it scales. Radix only takes a number for the padding, which just keeps it off the window's edge. */}
        <RadixPopover.Content
          ref={barRef}
          aria-label={barLabel}
          data-over-sheet
          side={side}
          align="center"
          collisionPadding={8}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (givesFocusBack.current) buttonRef.current?.focus();
          }}
          onEscapeKeyDown={() => {
            givesFocusBack.current = barRef.current?.contains(document.activeElement) ?? false;
          }}
          onInteractOutside={keepOpenForButton}
          onPointerEnter={onHover}
          onPointerLeave={onHoverEnd}
          onFocus={() => clearTimeout(timer.current)}
          onKeyDown={onBarKeyDown}
          onWheel={onWheel}
          className="pop z-50 flex w-48 max-w-(--radix-popover-content-available-width) origin-(--radix-popover-content-transform-origin) items-center gap-gap rounded-lg border border-border bg-surface-raised px-gutter shadow-xl outline-hidden no-drag data-[side=left]:mr-1 data-[side=top]:mb-1"
        >
          {openedByTouch ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={label}
              aria-pressed={isOn}
              onClick={() => onPressedChange(!isOn)}
              className={cn('shrink-0', isOn && 'text-accent hover:text-accent')}
            >
              <IconSwap id={String(isOn)}>{isOn ? <IconOn aria-hidden /> : <Icon aria-hidden />}</IconSwap>
            </Button>
          ) : null}
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
