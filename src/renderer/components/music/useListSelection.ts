import { useEffect, useMemo } from 'react';
import type { MusicItem } from '@/components/music/listItems';
import { isTyping } from '@/lib/listDom';
import { bindSelection, releaseSelection, selectAllRows } from '@/lib/selection';

function belongsToSomethingElse(target: EventTarget | null): boolean {
  if (isTyping(target)) return true;
  // A bottom sheet is only partly over the screen, and may hold the list this is for.
  const owner = '[role="dialog"]:not([data-bottom-sheet]), [role="alertdialog"], [role="menu"]';
  return target instanceof Element && target.closest(owner) !== null;
}

/** Ties the selection to this list, and gives it Ctrl+A wherever focus is, as long as it isn't something with its own. */
export function useListSelection(listKey: string, items: readonly MusicItem[]): void {
  const order = useMemo(() => items.flatMap((item) => (item.kind === 'track' ? [item.key] : [])), [items]);

  useEffect(() => {
    bindSelection(listKey, order);
  }, [listKey, order]);

  useEffect(() => () => releaseSelection(listKey), [listKey]);

  const hasRows = order.length > 0;
  useEffect(() => {
    if (!hasRows) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const isSelectAll = event.ctrlKey && !event.shiftKey && !event.altKey && event.code === 'KeyA';
      if (!isSelectAll || event.defaultPrevented || belongsToSomethingElse(event.target)) return;
      event.preventDefault();
      selectAllRows();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasRows]);
}
