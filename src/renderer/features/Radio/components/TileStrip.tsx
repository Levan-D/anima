import { useRef, type ReactNode } from 'react';
import { ScrollArrows } from '@/components/ui/ScrollArrows';
import { useScrollEnds } from '@/hooks/useScrollEnds';

/**
 * Tune it's tiles, wrapped into rows, and under sm one row that scrolls sideways, so a narrow window still has the rest of
 * Tune it close under it. A modal takes the window's width, so it goes by the window.
 */
export function TileStrip({ children }: { children: ReactNode }) {
  const strip = useRef<HTMLDivElement>(null);
  const { canGoBack, canGoForward, page } = useScrollEnds(strip);
  return (
    <div className="group/scroller relative w-full min-w-0">
      <div
        ref={strip}
        className="flex w-full flex-wrap justify-center gap-x-gap gap-y-section max-sm:[scrollbar-width:none] max-sm:flex-nowrap max-sm:justify-start max-sm:overflow-x-auto"
      >
        {children}
      </div>
      <ScrollArrows canGoBack={canGoBack} canGoForward={canGoForward} onPage={page} />
    </div>
  );
}
