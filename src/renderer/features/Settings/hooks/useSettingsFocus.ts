import { useEffect, useRef, type RefObject } from 'react';
import { focusCurrentList } from '@/lib/listDom';

/**
 * Arriving puts focus on the active tab, so the arrows work straight away and a keyboard starts where it was. Leaving gives
 * it back, unless going somewhere has already put it on what was pressed.
 */
export function useSettingsFocus(): RefObject<HTMLDivElement | null> {
  const pageRef = useRef<HTMLDivElement>(null);
  const focusedBefore = useRef<Element | null>(null);

  useEffect(() => {
    focusedBefore.current ??= document.activeElement;
    pageRef.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')?.focus();

    return () => {
      if (document.activeElement !== document.body) return;
      const before = focusedBefore.current;
      if (before instanceof HTMLElement && before !== document.body && before.isConnected) {
        before.focus({ preventScroll: true });
      } else {
        focusCurrentList();
      }
    };
  }, []);

  return pageRef;
}
