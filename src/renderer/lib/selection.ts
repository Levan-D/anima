/*
 * Which rows of the list on screen are picked. Only strings in a set, so selecting all of 5,700 rows touches no DOM, and
 * each row on screen asks about itself through a selector, so a change re-renders the rows whose answer changed.
 */
import { create } from 'zustand';

/** `anchor` is the row a Shift range is measured from. */
export type Selection = {
  keys: ReadonlySet<string>;
  anchor: string | null;
};

const NONE: Selection = { keys: new Set(), anchor: null };

export function toggleRow({ keys }: Selection, key: string): Selection {
  const next = new Set(keys);
  if (!next.delete(key)) next.add(key);
  return { keys: next, anchor: key };
}

function rowsBetween(order: readonly string[], one: string, other: string): string[] {
  const from = order.indexOf(one);
  const to = order.indexOf(other);
  if (from < 0 || to < 0) return [other];
  return order.slice(Math.min(from, to), Math.max(from, to) + 1);
}

/** Shift+click: everything from the anchor to here, and nothing else, as in File Explorer. */
export function extendToRow({ anchor }: Selection, order: readonly string[], key: string): Selection {
  const start = anchor ?? key;
  return { keys: new Set(rowsBetween(order, start, key)), anchor: start };
}

/** Shift+arrow: focus leaving the selection without Shift means the next range starts from where focus is. */
export function extendByKey(
  { keys, anchor }: Selection,
  order: readonly string[],
  from: string,
  to: string,
): Selection {
  const start = anchor !== null && keys.has(from) ? anchor : from;
  return { keys: new Set(rowsBetween(order, start, to)), anchor: start };
}

/** What's left once the list has changed, the same object when that's everything. */
export function keepRows(selection: Selection, order: readonly string[]): Selection {
  if (selection.keys.size === 0) return selection;
  const present = new Set(order);
  const keys = new Set([...selection.keys].filter((key) => present.has(key)));
  if (keys.size === selection.keys.size) return selection;
  return { keys, anchor: selection.anchor !== null && present.has(selection.anchor) ? selection.anchor : null };
}

type SelectionState = Selection & {
  listKey: string | null;
  /** Every row that can be picked, in order. Rows don't read this. */
  order: readonly string[];
  /** Selection mode, for a finger: a tap toggles instead of playing. */
  isSelecting: boolean;
};

const EMPTY: SelectionState = { ...NONE, listKey: null, order: [], isSelecting: false };

const useSelectionStore = create<SelectionState>()(() => EMPTY);

export function useSelection<T>(selector: (state: SelectionState) => T): T {
  return useSelectionStore(selector);
}

/** Whether there's a way out to show. One row picked with a click needs none: the next click moves it. */
export function isSelectionShowing({ isSelecting, keys }: SelectionState): boolean {
  return isSelecting || keys.size > 1;
}

/** The list on screen says what it is and what's in it. A different list starts with nothing picked. */
export function bindSelection(listKey: string, order: readonly string[]): void {
  useSelectionStore.setState((state) =>
    state.listKey === listKey ? { ...keepRows(state, order), order } : { ...EMPTY, listKey, order },
  );
}

export function releaseSelection(listKey: string): void {
  if (useSelectionStore.getState().listKey === listKey) useSelectionStore.setState(EMPTY);
}

/** Says whether there was anything showing to clear, because going back clears that before going anywhere. */
export function clearSelection(): boolean {
  const state = useSelectionStore.getState();
  useSelectionStore.setState({ ...NONE, isSelecting: false });
  return isSelectionShowing(state);
}

type RowPress = {
  ctrl: boolean;
  shift: boolean;
  /** A mouse selects the row it clicks. A finger or Enter is playing it, and leaves nothing selected. */
  isMouse: boolean;
};

/** A click or Enter on a row. True when that was only about the selection, so it can't also be a play. */
export function pressRow(key: string, { ctrl, shift, isMouse }: RowPress): boolean {
  const state = useSelectionStore.getState();
  if (shift) useSelectionStore.setState(extendToRow(state, state.order, key));
  else if (ctrl || state.isSelecting) useSelectionStore.setState(toggleRow(state, key));
  else if (isMouse) {
    useSelectionStore.setState({ keys: new Set([key]), anchor: key });
    return false;
  } else {
    useSelectionStore.setState({ keys: state.keys.size === 0 ? state.keys : NONE.keys, anchor: key });
    return false;
  }
  return true;
}

export function extendSelection(from: string, to: string): void {
  const state = useSelectionStore.getState();
  useSelectionStore.setState(extendByKey(state, state.order, from, to));
}

export function selectAllRows(): void {
  const { order } = useSelectionStore.getState();
  if (order.length > 0) useSelectionStore.setState({ keys: new Set(order) });
}

export function startSelecting(key: string): void {
  useSelectionStore.setState({ keys: new Set([key]), anchor: key, isSelecting: true });
}

export function selectedKeys(): ReadonlySet<string> {
  return useSelectionStore.getState().keys;
}

export function resetSelection(): void {
  useSelectionStore.setState(EMPTY);
}
