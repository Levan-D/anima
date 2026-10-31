import { useEffect } from 'react';
import { isTyping } from '@/lib/listDom';
import { goBack } from '@/lib/navigation';

function meansBack(event: KeyboardEvent): boolean {
  // A dialog or menu on top takes Escape for itself and says so, unless a toast that re-rendered got it first: Radix
  // counts that as the top layer, and the Escape closes the toast and isn't marked as used.
  if (document.querySelector('[role="dialog"], [role="menu"]')) return false;
  if (event.key === 'Escape') return !event.defaultPrevented;
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
