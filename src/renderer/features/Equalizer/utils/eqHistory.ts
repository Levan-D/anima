/* Undo and redo for the modal, as data. The latest value isn't kept here: whoever holds the EQ passes it in. */

import type { EqSettings } from '@shared/domain';

export type EqHistory = {
  past: readonly EqSettings[];
  future: readonly EqSettings[];
  /** Changes in the same group, like one drag, come back as one step. */
  group: string | null;
};

export const EMPTY_HISTORY: EqHistory = { past: [], future: [], group: null };

const MOST_STEPS = 100;

/** `before` is the EQ as it was just before this change. */
export function record(history: EqHistory, before: EqSettings, group: string | null): EqHistory {
  if (group !== null && group === history.group) return history;
  return { past: [...history.past, before].slice(-MOST_STEPS), future: [], group };
}

export function endGroup(history: EqHistory): EqHistory {
  return history.group === null ? history : { ...history, group: null };
}

export type HistoryMove = {
  history: EqHistory;
  eq: EqSettings;
};

export function undo(history: EqHistory, present: EqSettings): HistoryMove | null {
  const eq = history.past.at(-1);
  if (eq === undefined) return null;
  return { eq, history: { past: history.past.slice(0, -1), future: [present, ...history.future], group: null } };
}

export function redo(history: EqHistory, present: EqSettings): HistoryMove | null {
  const eq = history.future[0];
  if (eq === undefined) return null;
  return { eq, history: { past: [...history.past, present], future: history.future.slice(1), group: null } };
}
