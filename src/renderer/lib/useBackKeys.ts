import { useEffect } from 'react';
import { goBack } from '@/lib/navigation';

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function meansBack(event: KeyboardEvent): boolean {
  // Escape is the one key a dialog on top takes for itself, and it says so.
  if (event.key === 'Escape') return !event.defaultPrevented;
  if (document.querySelector('[role="dialog"]')) return false;
  if (event.key === 'ArrowLeft') return event.altKey;
  return event.key === 'Backspace' && !isTyping(event.target);
}

/** Escape, Alt+Left and Backspace go back, unless something open on top of the list has a use for them. */
export function useBackKeys(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (meansBack(event)) goBack();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
