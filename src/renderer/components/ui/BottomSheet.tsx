import { AnimatePresence, motion, useDragControls, type PanInfo } from 'motion/react';
import { Dialog as RadixDialog } from 'radix-ui';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { PanelHeader } from '@/components/ui/PanelHeader';
import { cn } from '@/lib/cn';
import { EASE_STANDARD, motionDuration } from '@/lib/motionTokens';

// The whole `transform`, not `scale`: only this way does it run on the compositor, out of reach of whatever React is doing.
const CLOSED = { opacity: 0, transform: 'scale(0.4)' };
const OPEN = { opacity: 1, transform: 'scale(1)' };

const DISMISS_FRACTION = 0.25;
const DISMISS_SPEED = 500;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** A line under the title. */
  subtitle?: ReactNode;
  /** In the header, before the close button. */
  actions?: ReactNode;
  closeLabel: string;
  /** What it rises out of and gives focus back to. */
  originOf: () => HTMLElement | null;
  /** Prevent it to keep the sheet open, for an Escape that was about something inside. */
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  /** Where it sits in its parent, and how tall. */
  className?: string;
  /** Does its own scrolling. Told when the sheet is up, so what's costly to mount can wait and the rise stays smooth. */
  children: (hasRisen: boolean) => ReactNode;
};

/** Measured from where the sheet is laid out, so it holds whatever it's being scaled by. */
function riseFrom(card: HTMLElement, origin: HTMLElement | null): void {
  const sheet = card.parentElement;
  const anchor = sheet?.parentElement;
  if (!sheet || !anchor || !origin) return;
  const from = origin.getBoundingClientRect();
  const { left, top } = anchor.getBoundingClientRect();
  const x = from.left + from.width / 2 - left - sheet.offsetLeft;
  const y = from.top + from.height / 2 - top - sheet.offsetTop;
  card.style.transformOrigin = `${x}px ${y}px`;
}

/**
 * A card that comes up from what's below it and leaves the screen showing around it. It sits in its parent, which must be
 * positioned, and is as wide as that, directly above it unless `className` says otherwise. What else is in the parent stays
 * usable while it's open, so pressing pause there doesn't dismiss it. Any other press outside does.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  subtitle,
  actions,
  closeLabel,
  originOf,
  onEscapeKeyDown,
  className,
  children,
}: Props) {
  const dragControls = useDragControls();
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const didDrag = useRef(false);
  const [hasRisen, setHasRisen] = useState(false);

  const attachCard = useCallback(
    (card: HTMLDivElement | null) => {
      if (!card) return undefined;
      riseFrom(card, originOf());
      // A timer and not the animation's end: a hidden window draws no frames, and would hold the list back for nothing.
      const risen = setTimeout(() => setHasRisen(true), motionDuration('--dur-mid') * 1000);
      return () => clearTimeout(risen);
    },
    [originOf],
  );

  function keepOpenForNeighbours(event: { target: EventTarget | null; preventDefault: () => void }): void {
    if (!(event.target instanceof Element)) return;
    const floatsOver = event.target.closest('[data-toast], [data-over-sheet]') !== null;
    if (floatsOver || sheetRef.current?.parentElement?.contains(event.target)) event.preventDefault();
  }

  function dismissIfFar(_event: unknown, { offset, velocity }: PanInfo): void {
    const height = sheetRef.current?.offsetHeight ?? 0;
    if (offset.y > height * DISMISS_FRACTION || velocity.y > DISMISS_SPEED) onOpenChange(false);
  }

  function pressHandle(): void {
    if (!didDrag.current) onOpenChange(false);
    didDrag.current = false;
  }

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence onExitComplete={() => setHasRisen(false)}>
        {open ? (
          <RadixDialog.Content
            asChild
            forceMount
            aria-describedby={undefined}
            data-bottom-sheet
            onOpenAutoFocus={(event) => {
              // The first thing to tab to could be something that acts, and a stray Enter would set it off.
              event.preventDefault();
              if (!sheetRef.current?.contains(document.activeElement)) sheetRef.current?.focus({ preventScroll: true });
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              // Something else may have taken focus on the way out, like the search field.
              if (document.activeElement === document.body) originOf()?.focus({ preventScroll: true });
            }}
            onInteractOutside={keepOpenForNeighbours}
            {...(onEscapeKeyDown ? { onEscapeKeyDown } : {})}
          >
            <motion.div
              ref={sheetRef}
              drag="y"
              dragControls={dragControls}
              dragListener={false}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 1 }}
              dragMomentum={false}
              dragSnapToOrigin
              onDragStart={() => {
                didDrag.current = true;
              }}
              onDragEnd={dismissIfFar}
              className={cn(
                'absolute inset-x-0 bottom-full z-30 mb-gap flex h-[60vh] max-h-[calc(100vh-var(--spacing-page-bar)-var(--spacing-island-clear))] flex-col outline-none',
                className,
              )}
            >
              <motion.div
                ref={attachCard}
                initial={CLOSED}
                animate={OPEN}
                exit={CLOSED}
                transition={{ duration: motionDuration('--dur-mid'), ease: EASE_STANDARD }}
                className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-surface-raised shadow-2xl"
              >
                <div
                  aria-hidden
                  data-testid="sheet-handle"
                  onPointerDown={(event) => dragControls.start(event)}
                  onClick={pressHandle}
                  className="flex h-5 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
                >
                  <span className="h-1 w-12 rounded-full bg-text-muted" />
                </div>
                <PanelHeader title={title} subtitle={subtitle} actions={actions} closeLabel={closeLabel} />
                <div className="relative flex min-h-0 flex-1 flex-col">{children(hasRisen)}</div>
              </motion.div>
            </motion.div>
          </RadixDialog.Content>
        ) : null}
      </AnimatePresence>
    </RadixDialog.Root>
  );
}
