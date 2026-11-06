import type { ReactNode } from 'react';
import { ScrollArrows } from '@/components/ui/ScrollArrows';
import { useCarousel } from '@/hooks/useCarousel';
import { cn } from '@/lib/cn';

type Props = {
  /** Announced to screen readers: what's in it. */
  label: string;
  /** The slides, one element each, which set their own width. */
  children: ReactNode;
  className?: string;
};

/**
 * A row of slides that glides as it scrolls. One tab stop, with the arrow keys and Home and End on it. The arrows are for
 * the pointer: a keyboard has its own, so they aren't tab stops, and a finger swipes.
 */
export function Carousel({ label, children, className }: Props) {
  const { ref, canGoBack, canGoForward, page, onKeyDown, onFocus, onBlur } = useCarousel<HTMLDivElement>();

  return (
    <div
      role="group"
      aria-roledescription="carousel"
      aria-label={label}
      className={cn('group/scroller relative min-w-0', className)}
    >
      <div
        ref={ref}
        // It hands focus on to a slide's button, and keeps it when a slide has none.
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        data-testid="carousel"
        className="flex scroll-px-gutter [scrollbar-width:none] gap-section overflow-x-auto px-gutter py-section focus-inset *:shrink-0"
      >
        {children}
      </div>
      <ScrollArrows canGoBack={canGoBack} canGoForward={canGoForward} onPage={page} />
    </div>
  );
}
