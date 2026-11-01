import { useEffect, useRef } from 'react';
import type { EqSettings } from '@shared/domain';
import {
  EMPTY_HISTORY,
  endGroup as endHistoryGroup,
  record,
  redo,
  undo,
  type HistoryMove,
} from '@/features/Equalizer/utils/eqHistory';

function moveFor(event: KeyboardEvent): 'undo' | 'redo' | null {
  if (!event.ctrlKey || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === 'y' || (key === 'z' && event.shiftKey)) return 'redo';
  return key === 'z' ? 'undo' : null;
}

/** Ctrl+Z and Ctrl+Y while the modal is up, starting afresh each time it opens. A field being typed in keeps its own. */
export function useEqHistory(isOpen: boolean, latest: () => EqSettings, change: (eq: EqSettings) => void) {
  const history = useRef(EMPTY_HISTORY);
  const current = useRef({ latest, change });
  useEffect(() => {
    current.current = { latest, change };
  });

  useEffect(() => {
    if (!isOpen) return undefined;
    function onKeyDown(event: KeyboardEvent): void {
      const move = moveFor(event);
      if (move === null || (event.target instanceof HTMLElement && event.target.closest('input'))) return;
      event.preventDefault();
      const present = current.current.latest();
      const moved: HistoryMove | null =
        move === 'undo' ? undo(history.current, present) : redo(history.current, present);
      if (moved === null) return;
      history.current = moved.history;
      current.current.change(moved.eq);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      history.current = EMPTY_HISTORY;
    };
  }, [isOpen]);

  return {
    /** The way every change goes in, so it can be taken back. Changes sharing a `group` are one step. */
    edit: (next: EqSettings, group: string | null = null): void => {
      history.current = record(history.current, latest(), group);
      change(next);
    },
    endGroup: (): void => {
      history.current = endHistoryGroup(history.current);
    },
  };
}
