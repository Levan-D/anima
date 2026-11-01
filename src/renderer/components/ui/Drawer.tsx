import { AnimatePresence, motion } from 'motion/react';
import { Dialog as RadixDialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { PanelHeader } from '@/components/ui/PanelHeader';
import { EASE_STANDARD, motionDuration } from '@/lib/motionTokens';

const CLOSED = { transform: 'translateX(100%)' };
const OPEN = { transform: 'translateX(0%)' };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  closeLabel: string;
  /** Does its own scrolling. */
  children: ReactNode;
};

/** A toast floats over the scrim, and dismissing one isn't a click outside. */
function keepOpenForToast(event: { target: EventTarget | null; preventDefault: () => void }): void {
  if (event.target instanceof Element && event.target.closest('[data-toast]')) event.preventDefault();
}

/**
 * A panel that slides over the page from the side, closing on its X, Esc and a press outside. The whole window on a small
 * one. Focus goes to the panel rather than the first thing in it, so a stray Enter can't set anything off.
 */
export function Drawer({ open, onOpenChange, title, closeLabel, children }: Props) {
  const transition = { duration: motionDuration('--dur-mid'), ease: EASE_STANDARD };

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <RadixDialog.Portal forceMount>
            <RadixDialog.Overlay asChild forceMount>
              <motion.div
                data-scrim
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={transition}
                className="fixed inset-0 z-40 bg-scrim no-drag"
              />
            </RadixDialog.Overlay>
            <RadixDialog.Content
              asChild
              forceMount
              aria-describedby={undefined}
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                (event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
              }}
              onInteractOutside={keepOpenForToast}
            >
              <motion.div
                initial={CLOSED}
                animate={OPEN}
                exit={CLOSED}
                transition={transition}
                className="fixed inset-y-0 right-0 z-40 flex w-full flex-col bg-surface pt-title-bar shadow-2xl outline-none no-drag sm:w-140"
              >
                <PanelHeader title={title} closeLabel={closeLabel} />
                <div className="flex min-h-0 flex-1 flex-col">{children}</div>
              </motion.div>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        ) : null}
      </AnimatePresence>
    </RadixDialog.Root>
  );
}
