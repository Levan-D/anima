import { useEffect, type RefObject } from 'react';

/** The keyboard lands in the panel when it opens, and goes back to where it was when it closes. */
export function useFocusWhileOpen(panel: RefObject<HTMLElement | null>, selector: string): void {
  useEffect(() => {
    const before = document.activeElement;
    panel.current?.querySelector<HTMLElement>(selector)?.focus();
    return () => {
      if (before instanceof HTMLElement) before.focus();
    };
  }, [panel, selector]);
}
