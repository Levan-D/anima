import { useEffect, useRef, type RefObject } from 'react';
import { motionDuration } from '@/lib/motionTokens';

/** Fades the element in again when `value` changes, without remounting it, so whatever has focus in it keeps it. */
export function useFadeOnChange<Element extends HTMLElement>(value: unknown): RefObject<Element | null> {
  const ref = useRef<Element>(null);
  const shown = useRef(value);

  useEffect(() => {
    if (shown.current === value) return;
    shown.current = value;
    const duration = motionDuration('--dur-quick') * 1000;
    if (duration > 0) ref.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: 'ease-out' });
  }, [value]);

  return ref;
}
