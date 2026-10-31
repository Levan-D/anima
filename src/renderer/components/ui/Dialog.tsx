import { Dialog as RadixDialog } from 'radix-ui';
import { Children, useRef, type ReactElement, type ReactNode } from 'react';
import { Text } from '@/components/ui/Text';
import { cn } from '@/lib/cn';
import { focusCurrentList } from '@/lib/listDom';

type Props = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The element that opens it. Leave it out when `open` is controlled from elsewhere. */
  trigger?: ReactNode;
  title: string;
  description?: string;
  /** Using one closes the dialog, unless its onClick calls preventDefault. */
  actions?: ReactElement | ReactElement[];
  /** Radix puts focus back on what had it. Prevent that, and say where, when that has gone. */
  onCloseAutoFocus?: (event: Event) => void;
  className?: string;
  children?: ReactNode;
};

export function Dialog({
  trigger,
  title,
  description,
  actions,
  onCloseAutoFocus,
  className,
  children,
  ...rootProps
}: Props) {
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
        <RadixDialog.Overlay className="fixed inset-0 z-40 flex items-center justify-center bg-scrim p-gutter no-drag data-[state=closed]:animate-fade-out">
          <RadixDialog.Content
            onOpenAutoFocus={() => {
              focusedBefore.current = document.activeElement;
            }}
            onCloseAutoFocus={returnFocus}
            className={cn(
              'flex max-h-full w-110 max-w-full flex-col gap-gap overflow-y-auto rounded-lg bg-surface-raised p-section shadow-xl',
              'data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-rise',
              className,
            )}
          >
            <RadixDialog.Title asChild>
              <Text as="h2" variant="lead">
                {title}
              </Text>
            </RadixDialog.Title>
            {description ? (
              <RadixDialog.Description asChild>
                <Text as="p" color="muted">
                  {description}
                </Text>
              </RadixDialog.Description>
            ) : null}
            {children}
            {actions ? (
              <div className="flex flex-wrap justify-end gap-2">
                {Children.map(actions, (action) => (
                  <RadixDialog.Close asChild>{action}</RadixDialog.Close>
                ))}
              </div>
            ) : null}
          </RadixDialog.Content>
        </RadixDialog.Overlay>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
