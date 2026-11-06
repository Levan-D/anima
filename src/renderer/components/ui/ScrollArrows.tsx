import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

const ARROW = cn(
  'absolute top-1/2 z-10 -translate-y-1/2 rounded-full shadow-lg',
  'pointer-events-none opacity-0 transition-[background-color,opacity] duration-(--dur-fast) ease-standard',
  'group-focus-within/scroller:pointer-events-auto group-focus-within/scroller:opacity-100',
  'group-hover/scroller:pointer-events-auto group-hover/scroller:opacity-100',
);

type Props = {
  canGoBack: boolean;
  canGoForward: boolean;
  onPage: (direction: 1 | -1) => void;
};

/**
 * Over the ends of a sideways strip, inside a `group/scroller`, showing on hover. For the pointer only: a keyboard has its
 * own keys, so they aren't tab stops, and a finger swipes.
 */
export function ScrollArrows({ canGoBack, canGoForward, onPage }: Props) {
  return (
    <>
      {canGoBack ? (
        <Button
          tabIndex={-1}
          size="icon"
          aria-label="Scroll back"
          onClick={() => onPage(-1)}
          className={cn(ARROW, 'left-3')}
        >
          <ChevronLeft aria-hidden />
        </Button>
      ) : null}
      {canGoForward ? (
        <Button
          tabIndex={-1}
          size="icon"
          aria-label="Scroll forward"
          onClick={() => onPage(1)}
          className={cn(ARROW, 'right-3')}
        >
          <ChevronRight aria-hidden />
        </Button>
      ) : null}
    </>
  );
}
