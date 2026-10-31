import { useEffect, type RefObject } from 'react';

const FOCUSABLE = 'button, input, [role="slider"], [tabindex="0"]';

function focusablesIn(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.getClientRects().length > 0 && !element.matches(':disabled, [aria-disabled="true"]'),
  );
}

/**
 * For a panel over part of the window: the keyboard lands in it when it opens, Tab goes round inside it, and focus goes
 * back to where it was when it closes. Without a `selector`, it lands on the panel, which needs `tabIndex={-1}`.
 */
export function useOverlayFocus(panel: RefObject<HTMLElement | null>, selector?: string): void {
  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    const before = document.activeElement;
    const start = selector === undefined ? element : (element.querySelector<HTMLElement>(selector) ?? element);
    start.focus({ preventScroll: selector === undefined });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const inside = focusablesIn(element);
      const first = inside[0];
      const last = inside.at(-1);
      const active = document.activeElement;
      if (first === undefined || last === undefined) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && (active === first || active === element)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    element.addEventListener('keydown', onKeyDown);

    return () => {
      element.removeEventListener('keydown', onKeyDown);
      if (before instanceof HTMLElement) before.focus({ preventScroll: true });
    };
  }, [panel, selector]);
}
