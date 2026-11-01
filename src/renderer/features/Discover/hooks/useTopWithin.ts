import { useCallback, useState, type RefObject } from 'react';

/** How far down its scroller an element starts, whatever the scroll position. Follows what's above it as that rewraps. */
export function useTopWithin<T extends HTMLElement>(
  scrollerRef: RefObject<HTMLElement | null>,
): [ref: (element: T | null) => (() => void) | void, top: number] {
  const [top, setTop] = useState(0);

  const ref = useCallback(
    (element: T | null) => {
      const scroller = scrollerRef.current;
      if (!element || !scroller) return;

      const measure = () => {
        setTop(element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop);
      };
      measure();

      const observer = new ResizeObserver(measure);
      observer.observe(scroller);
      if (element.parentElement) observer.observe(element.parentElement);
      return () => observer.disconnect();
    },
    [scrollerRef],
  );

  return [ref, top];
}
