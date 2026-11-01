import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { useCarousel } from '@/hooks/useCarousel';
import { cn } from '@/lib/cn';

const ARROW = cn(
  'absolute top-1/2 z-10 -translate-y-1/2 rounded-full shadow-lg',
  'pointer-events-none opacity-0 transition-[background-color,opacity] duration-(--dur-fast) ease-standard',
  'group-focus-within/carousel:pointer-events-auto group-focus-within/carousel:opacity-100',
  'group-hover/carousel:pointer-events-auto group-hover/carousel:opacity-100',
);

type Props = {
  /** Announced to screen readers: what's in it. */
  label: string;
  /** The slides, one element each, which set their own width. */
  children: ReactNode;
  className?: string;
};

/**
 * A row of slides that snaps as it scrolls. One tab stop, with the arrow keys and Home and End on it. The arrows are for
 * the pointer: a keyboard has its own, so they aren't tab stops, and a finger swipes.
 */
export function Carousel({ label, children, className }: Props) {
  const { ref, canGoBack, canGoForward, page, onKeyDown } = useCarousel<HTMLDivElement>();

  return (
    <div
      role="group"
      aria-roledescription="carousel"
      aria-label={label}
      className={cn('group/carousel relative min-w-0', className)}
    >
      <div
        ref={ref}
        // Nothing in a slide takes focus, so the strip has to.
        tabIndex={0}
        onKeyDown={onKeyDown}
        data-testid="carousel"
        className="flex snap-x snap-mandatory scroll-px-gutter [scrollbar-width:none] gap-section overflow-x-auto px-gutter py-2 focus-inset *:shrink-0 *:snap-start"
      >
        {children}
      </div>
      {canGoBack ? (
        <Button
          tabIndex={-1}
          size="icon"
          aria-label="Scroll back"
          onClick={() => page(-1)}
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
          onClick={() => page(1)}
          className={cn(ARROW, 'right-3')}
        >
          <ChevronRight aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
