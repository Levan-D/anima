import { useCallback, useState } from 'react';

type Size = {
  width: number;
  height: number;
};

const NOTHING_YET: Size = { width: 0, height: 0 };

/** Follows an element's size. It's measured as it mounts, so the first paint already has the right one. */
export function useElementSize<T extends Element>(): [ref: (element: T | null) => (() => void) | void, size: Size] {
  const [size, setSize] = useState(NOTHING_YET);

  const ref = useCallback((element: T | null) => {
    if (!element) return;

    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setSize((current) => (current.width === width && current.height === height ? current : { width, height }));
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}
