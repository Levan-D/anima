import { useEffect, useRef } from 'react';

/**
 * A row of tabs that scrolls sideways when it doesn't fit. A keyboard is followed by the browser and a finger scrolls it,
 * but a wheel only goes up and down, and a tab chosen some other way has to come into view by itself.
 */
export function useTabStrip<Element extends HTMLElement>(activeValue: string) {
  const ref = useRef<Element>(null);

  useEffect(() => {
    const strip = ref.current;
    if (!strip) return;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaX === 0) strip.scrollLeft += event.deltaY;
    };
    strip.addEventListener('wheel', onWheel, { passive: true });
    return () => strip.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const strip = ref.current;
    const active = strip?.querySelector('[data-state="active"]');
    if (!strip || !active) return;
    const box = strip.getBoundingClientRect();
    const { left, right } = active.getBoundingClientRect();
    if (left < box.left) strip.scrollLeft -= box.left - left;
    else if (right > box.right) strip.scrollLeft += right - box.right;
  }, [activeValue]);

  return ref;
}
