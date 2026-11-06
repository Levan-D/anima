import { useCallback, useEffect, useState, type RefObject } from 'react';

type Ends = {
  canGoBack: boolean;
  canGoForward: boolean;
};

// Most of a view, so what was at the edge is still in sight after the move.
const PAGE = 0.8;

/** Whether a sideways strip has more either way, and a page's move towards it, for arrows in place of a scrollbar. */
export function useScrollEnds(ref: RefObject<HTMLElement | null>) {
  const [ends, setEnds] = useState<Ends>({ canGoBack: false, canGoForward: false });

  useEffect(() => {
    const strip = ref.current;
    if (!strip) return;
    const update = () => {
      const canGoBack = strip.scrollLeft > 1;
      const canGoForward = strip.scrollLeft < strip.scrollWidth - strip.clientWidth - 1;
      setEnds((now) =>
        now.canGoBack === canGoBack && now.canGoForward === canGoForward ? now : { canGoBack, canGoForward },
      );
    };
    update();
    // The content too: what's in it can grow or shrink while the strip stays the same size.
    const observer = new ResizeObserver(update);
    observer.observe(strip);
    if (strip.firstElementChild) observer.observe(strip.firstElementChild);
    strip.addEventListener('scroll', update, { passive: true });
    return () => {
      observer.disconnect();
      strip.removeEventListener('scroll', update);
    };
  }, [ref]);

  const page = useCallback(
    (direction: 1 | -1) => {
      const strip = ref.current;
      if (!strip) return;
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      strip.scrollBy({ left: direction * strip.clientWidth * PAGE, behavior: reduced ? 'auto' : 'smooth' });
    },
    [ref],
  );

  return { ...ends, page };
}
