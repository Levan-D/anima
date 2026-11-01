import { X } from 'lucide-react';
import { AnimatePresence, motion, useDragControls, type PanInfo } from 'motion/react';
import { Dialog as RadixDialog } from 'radix-ui';
import { useCallback, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { Text } from '@/components/ui/Text';
import { motionDuration } from '@/lib/motionTokens';

const CLOSED = { opacity: 0, scale: 0.4 };
const OPEN = { opacity: 1, scale: 1 };
const EASE_STANDARD = [0.2, 0, 0, 1] as const;

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
  /** Does its own scrolling. */
  children: ReactNode;
};

function riseFrom(sheet: HTMLElement, origin: HTMLElement | null): void {
  const anchor = sheet.parentElement;
  if (!anchor || !origin) return;
  const from = origin.getBoundingClientRect();
  const { left, top } = anchor.getBoundingClientRect();
  const x = from.left + from.width / 2 - left;
  const y = from.top + from.height / 2 - top;
  sheet.style.transformOrigin = `${x}px calc(100% + ${y}px)`;
}

/**
 * A card that comes up from what's below it and leaves the screen showing around it. It sits in its parent, which must be
 * positioned, directly above and as wide as that. What else is in the parent stays usable while it's open, so pressing
 * pause there doesn't dismiss it. Any other press outside does.
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
  children,
}: Props) {
  const dragControls = useDragControls();
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const didDrag = useRef(false);

  const attach = useCallback(
    (sheet: HTMLDivElement | null) => {
      sheetRef.current = sheet;
      if (sheet) riseFrom(sheet, originOf());
    },
    [originOf],
  );

  function keepOpenForNeighbours(event: { target: EventTarget | null; preventDefault: () => void }): void {
    if (!(event.target instanceof Element)) return;
    const isToast = event.target.closest('[data-toast]') !== null;
    if (isToast || sheetRef.current?.parentElement?.contains(event.target)) event.preventDefault();
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
      <AnimatePresence>
        {open ? (
          <RadixDialog.Content
            asChild
            forceMount
            aria-describedby={undefined}
            data-bottom-sheet
            onOpenAutoFocus={(event) => {
              // The first thing to tab to could be something that acts, and a stray Enter would set it off.
              event.preventDefault();
              if (!sheetRef.current?.contains(document.activeElement)) sheetRef.current?.focus();
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
              ref={attach}
              initial={CLOSED}
              animate={OPEN}
              exit={CLOSED}
              transition={{ duration: motionDuration('--dur-fast'), ease: EASE_STANDARD }}
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
              className="absolute inset-x-0 bottom-full z-30 mb-gap flex h-[60vh] max-h-[calc(100vh-var(--spacing-page-bar)-var(--spacing-island-clear))] flex-col overflow-hidden rounded-lg bg-surface-raised shadow-2xl outline-none"
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
              <div className="flex shrink-0 items-center gap-1 pr-1 pb-1 pl-gutter">
                <div className="flex min-w-0 flex-1 flex-col">
                  <RadixDialog.Title asChild>
                    <Text as="h2" variant="lead" truncate>
                      {title}
                    </Text>
                  </RadixDialog.Title>
                  {subtitle}
                </div>
                {actions}
                <RadixDialog.Close asChild>
                  <Button variant="ghost" size="icon" aria-label={closeLabel} className="shrink-0">
                    <X aria-hidden />
                  </Button>
                </RadixDialog.Close>
              </div>
              <Divider />
              <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
            </motion.div>
          </RadixDialog.Content>
        ) : null}
      </AnimatePresence>
    </RadixDialog.Root>
  );
}
