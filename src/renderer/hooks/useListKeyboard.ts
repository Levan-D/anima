import { useCallback, useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent, type RefObject } from 'react';
import { nextCell } from '@/lib/listKeys';
import { recallList, rememberFocus, takeArrival, type ListCell } from '@/lib/listMemory';

type Options = {
  listRef: RefObject<HTMLElement | null>;
  /** Written here, for the virtualizer: the focused row has to stay rendered. */
  focusedRef: RefObject<ListCell | null>;
  memoryKey: string;
  /** A new one means it's a different list now, with nothing of the old one to come back to. */
  resetKey: string | null;
  count: number;
  columnsAt: (index: number) => number;
  /** The first item worth landing on when focus arrives from outside. */
  firstVisibleIndex: () => number | null;
  /** How many items a Page Up or Page Down moves from this one. */
  pageSize: (index: number) => number;
  scrollToIndex: (index: number) => void;
  /** What a cell holds, which outlasts where it happens to be. */
  keyOfCell: (cell: ListCell) => string | null;
  findCell: (key: string) => ListCell | null;
  /** Arrow Up on the first row: there's nowhere further up in the list. */
  onLeaveTop: (() => void) | undefined;
  /** A move with Shift held, as well as the move itself. */
  onShiftMove: (from: ListCell, to: ListCell) => void;
};

function itemElement(list: HTMLElement, index: number): Element | null {
  return list.querySelector(`[data-index="${index}"]`);
}

function buttonAt(list: HTMLElement, { index, column }: ListCell): HTMLElement | null {
  return itemElement(list, index)?.querySelectorAll('button')[column] ?? null;
}

function cellOf(target: Element): ListCell | null {
  const item = target.closest('[data-index]');
  const button = target.closest('button');
  if (!item || !button) return null;
  return {
    index: Number(item.getAttribute('data-index')),
    column: [...item.querySelectorAll('button')].indexOf(button),
  };
}

/**
 * One tab stop however long the list is, with the arrow keys moving through it. The list element holds the tab stop
 * and hands focus to a row, so rows stay plain and nothing re-renders as focus moves. Works on a virtual list: a cell
 * that isn't in the DOM yet is scrolled to, and focused once it arrives.
 */
export function useListKeyboard({
  listRef,
  focusedRef,
  memoryKey,
  resetKey,
  count,
  columnsAt,
  firstVisibleIndex,
  pageSize,
  scrollToIndex,
  keyOfCell,
  findCell,
  onLeaveTop,
  onShiftMove,
}: Options) {
  const pending = useRef<ListCell | null>(null);
  const isFirstCommit = useRef(true);
  const wantsFocusOnArrival = useRef(false);
  const lastResetKey = useRef(resetKey);
  const focused = useRef<{ element: Element; key: string } | null>(null);

  const focusCell = useCallback(
    (cell: ListCell) => {
      const list = listRef.current;
      if (!list) return;
      scrollToIndex(cell.index);
      const button = buttonAt(list, cell);
      if (button) {
        pending.current = null;
        button.focus({ preventScroll: true });
      } else {
        pending.current = cell;
      }
    },
    [listRef, scrollToIndex],
  );

  useLayoutEffect(() => {
    if (isFirstCommit.current) {
      isFirstCommit.current = false;
      // What had focus was in the list this one replaced, so the keyboard would otherwise start over from the top.
      const arrival = takeArrival();
      const { focus } = recallList(memoryKey);
      if (arrival === 'went-back' && focus !== null) pending.current = focus;
      // Leaving search from the field keeps focus in the field. Only a result that had it leaves it with nowhere to be.
      else if (arrival === 'left-search' && focus !== null && document.activeElement === document.body) {
        pending.current = focus;
      } else if (arrival !== 'none') wantsFocusOnArrival.current = true;
    }

    if (lastResetKey.current !== resetKey) {
      lastResetKey.current = resetKey;
      focused.current = null;
      focusedRef.current = null;
    }

    const list = listRef.current;
    if (!list) return;

    if (wantsFocusOnArrival.current) {
      const index = firstVisibleIndex();
      if (index === null) return;
      wantsFocusOnArrival.current = false;
      if (document.activeElement === document.body) pending.current = { index, column: 0 };
    }

    // A refresh can remount what had focus, as when a new album pushes a card into the next lane of the grid.
    const was = focused.current;
    if (pending.current === null && was !== null) {
      if (was.element.isConnected) {
        if (document.activeElement !== was.element) focused.current = null;
      } else if (document.activeElement === document.body) {
        const cell = findCell(was.key);
        focused.current = null;
        if (cell !== null) {
          focusedRef.current = cell;
          pending.current = cell;
          scrollToIndex(cell.index);
        }
      } else {
        focused.current = null;
      }
    }

    if (pending.current === null) return;
    const button = buttonAt(list, pending.current);
    if (!button) return;
    pending.current = null;
    button.focus({ preventScroll: true });
  });

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const from = cellOf(event.target as Element);
      if (!from) return;
      const to = nextCell(event.key, from, { count, columnsAt, pageSize: pageSize(from.index) });
      if (!to) {
        if (event.key === 'ArrowUp' && !event.shiftKey && onLeaveTop) {
          event.preventDefault();
          onLeaveTop();
        }
        return;
      }
      event.preventDefault();
      if (event.shiftKey) onShiftMove(from, to);
      focusCell(to);
    },
    [columnsAt, count, focusCell, onLeaveTop, onShiftMove, pageSize],
  );

  const onFocus = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      const list = event.currentTarget;
      if (event.target !== list) {
        // While a row has focus, Shift+Tab has to leave the list instead of landing on its tab stop.
        list.tabIndex = -1;
        const cell = cellOf(event.target);
        if (cell) {
          focusedRef.current = cell;
          rememberFocus(memoryKey, cell);
          const key = keyOfCell(cell);
          focused.current = key === null ? null : { element: event.target, key };
        }
        return;
      }

      const index = focusedRef.current?.index ?? firstVisibleIndex();
      if (index !== null) focusCell(focusedRef.current ?? { index, column: 0 });
    },
    [firstVisibleIndex, focusCell, focusedRef, keyOfCell, memoryKey],
  );

  const onBlur = useCallback((event: FocusEvent<HTMLElement>) => {
    const list = event.currentTarget;
    if (!list.contains(event.relatedTarget)) list.tabIndex = 0;
  }, []);

  return { onKeyDown, onFocus, onBlur };
}
