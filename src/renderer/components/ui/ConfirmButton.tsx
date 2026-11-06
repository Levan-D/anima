import { useRef, useState, type ComponentProps, type FocusEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useElementSize } from '@/hooks/useElementSize';
import { useTimeoutWhile } from '@/hooks/useTimeoutWhile';
import { cn } from '@/lib/cn';

const ASKS_FOR_MS = 5000;

type Props = Omit<ComponentProps<typeof Button>, 'onClick' | 'autoFocus'> & {
  onConfirm: () => void;
  /** False when there's nothing to lose, and the first press does it. */
  asks?: boolean;
  /** Takes its parent's width, as a row in a list does, so only the height moves. */
  fill?: boolean;
};

/** Asks in place before something that can't be undone. It stops asking after a few seconds, or when focus leaves. */
export function ConfirmButton({ onConfirm, asks = true, fill = false, children, ...button }: Props) {
  const outer = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'idle' | 'asking' | 'returning'>('idle');
  const [measure, size] = useElementSize<HTMLDivElement>();
  const isAsking = phase === 'asking';

  // The button being pressed goes away, and focus mustn't go with it.
  function stopAsking(): void {
    setPhase(outer.current?.contains(document.activeElement) ? 'returning' : 'idle');
  }

  function leaveOnBlur(event: FocusEvent<HTMLDivElement>): void {
    if (isAsking && !event.currentTarget.contains(event.relatedTarget)) setPhase('idle');
  }

  useTimeoutWhile(isAsking, ASKS_FOR_MS, stopAsking);

  // Left to size itself until it's measured: from `auto` there's no transition, so it doesn't grow in from nothing.
  // Rounded up: a width a fraction short clips the button's right edge.
  const measured = fill ? { height: size.height } : { width: Math.ceil(size.width), height: size.height };

  return (
    <div
      ref={outer}
      {...(size.height === 0 ? {} : { style: measured })}
      onBlur={leaveOnBlur}
      className={cn(
        'max-w-full shrink-0 transition-[width,height] duration-(--dur-mid) ease-standard [overflow-clip-margin:calc(var(--focus-width)*2)]',
        // Only sideways, so a finger-sized box can still reach past a small button's top and bottom.
        fill ? 'w-full overflow-clip' : 'overflow-x-clip',
      )}
    >
      <div ref={measure} className={cn('flex', fill ? 'w-full' : 'w-max')}>
        {isAsking ? (
          <div
            role="group"
            aria-label="Are you sure?"
            className={cn('animate-fade-rise flex items-center gap-2', fill && 'min-h-tap w-full justify-between px-2')}
          >
            <Text variant="meta" color="muted">
              Are you sure?
            </Text>
            <span className="flex gap-2">
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  stopAsking();
                  onConfirm();
                }}
              >
                Confirm
              </Button>
              <Button variant="outline" size="sm" autoFocus onClick={stopAsking}>
                Cancel
              </Button>
            </span>
          </div>
        ) : (
          <Button {...button} autoFocus={phase === 'returning'} onClick={asks ? () => setPhase('asking') : onConfirm}>
            {children}
          </Button>
        )}
      </div>
    </div>
  );
}
