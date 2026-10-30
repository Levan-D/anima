import { useLayoutEffect, useRef } from 'react';

/** For something that changes the layout around itself: when `value` changes, it scrolls itself back into view. */
export function useStaysInView<T extends Element>(value: unknown) {
  const ref = useRef<T>(null);
  const last = useRef(value);

  useLayoutEffect(() => {
    if (last.current === value) return;
    last.current = value;
    ref.current?.scrollIntoView({ block: 'nearest' });
  }, [value]);

  return ref;
}
