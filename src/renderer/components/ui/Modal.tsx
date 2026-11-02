import { X } from 'lucide-react';
import { Dialog as RadixDialog } from 'radix-ui';
import { useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { Text } from '@/components/ui/Text';
import { cn } from '@/lib/cn';
import { focusCurrentList } from '@/lib/listDom';

export type ModalSize = 'sm' | 'lg' | 'tall';

// Numeric, so they grow with the window, and max-full keeps them inside a small one.
const sizeClasses: Record<ModalSize, string> = {
  sm: 'w-110',
  lg: 'h-200 w-270',
  tall: 'h-265 w-320',
};

export type ModalProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The element that opens it. Leave it out when `open` is controlled from elsewhere. */
  trigger?: ReactNode;
  /** Shown, and what a screen reader announces it as. */
  title: string;
  description?: string;
  /** Right beside the title. */
  titleAside?: ReactNode;
  size?: ModalSize;
  /** Gives it a close button, named this. */
  closeLabel?: string;
  /** Radix focuses the first thing it can. Prevent that, and say where, for somewhere better. */
  onOpenAutoFocus?: (event: Event) => void;
  /** Radix puts focus back on what had it. Prevent that, and say where, when that has gone. */
  onCloseAutoFocus?: (event: Event) => void;
  className?: string;
  /** Under the title, as tall as what's left. What's in it does its own scrolling. */
  children?: ReactNode;
};

/** A toast floats over the scrim, and dismissing one isn't a click outside. */
function keepOpenForToast(event: { target: EventTarget | null; preventDefault: () => void }): void {
  if (event.target instanceof Element && event.target.closest('[data-toast]')) event.preventDefault();
}

/** The one base for anything over a scrim: closes on Esc and a press outside, traps focus and gives it back. */
export function Modal({
  trigger,
  title,
  description,
  titleAside,
  size = 'sm',
  closeLabel,
  onOpenAutoFocus,
  onCloseAutoFocus,
  className,
  children,
  ...rootProps
}: ModalProps) {
  const focusedBefore = useRef<Element | null>(null);

  // With no trigger Radix would put focus nowhere: it only goes back to one. What opened this may be a menu that's gone.
  function returnFocus(event: Event): void {
    if (onCloseAutoFocus) {
      onCloseAutoFocus(event);
      return;
    }
    if (trigger) return;
    event.preventDefault();
    const before = focusedBefore.current;
    if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true });
    else focusCurrentList();
  }

  return (
    <RadixDialog.Root {...rootProps}>
      {trigger ? <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger> : null}
      <RadixDialog.Portal>
        {/* Clear of the title bar's strip on top, where a window this small would put a button under the window controls. */}
        <RadixDialog.Overlay
          data-scrim
          className="pop-fade fixed inset-0 z-40 flex items-center justify-center bg-scrim p-gutter pt-title-bar no-drag"
        >
          <RadixDialog.Content
            onOpenAutoFocus={(event) => {
              focusedBefore.current = document.activeElement;
              onOpenAutoFocus?.(event);
            }}
            onCloseAutoFocus={returnFocus}
            onInteractOutside={keepOpenForToast}
            className={cn(
              'pop flex max-h-full max-w-full flex-col overflow-hidden rounded-lg bg-surface-raised shadow-xl',
              sizeClasses[size],
              className,
            )}
          >
            <div className="flex shrink-0 flex-col gap-gap p-section">
              <div className="flex items-center gap-gap">
                <RadixDialog.Title asChild>
                  <Text as="h2" variant="lead" className="min-w-0">
                    {title}
                  </Text>
                </RadixDialog.Title>
                {titleAside}
                {closeLabel === undefined ? null : (
                  <RadixDialog.Close asChild>
                    <Button variant="ghost" size="icon" aria-label={closeLabel} className="-my-2 ml-auto shrink-0">
                      <X aria-hidden />
                    </Button>
                  </RadixDialog.Close>
                )}
              </div>
              {description ? (
                <RadixDialog.Description asChild>
                  <Text as="p" color="muted">
                    {description}
                  </Text>
                </RadixDialog.Description>
              ) : null}
            </div>
            <Divider />
            {children}
          </RadixDialog.Content>
        </RadixDialog.Overlay>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
