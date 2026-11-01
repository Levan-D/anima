/* Moving between the list and what's above it, which don't know about each other: the tabs, the search field, the rows. */

export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function currentList(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="tabpanel"] [role="list"]');
}

/** Into whatever list is showing, whose own focus handler picks the row. False when there isn't one. */
export function focusCurrentList(): boolean {
  const list = currentList();
  list?.focus();
  return list !== null;
}

/** Back up out of a list: to its tab, to the search field when search has replaced it, or to its page when it has neither. */
export function focusAboveList(): void {
  const above =
    document.querySelector<HTMLElement>('[role="tab"][data-state="active"]') ??
    document.querySelector<HTMLElement>('input[type="search"]') ??
    document.querySelector<HTMLElement>('[aria-current="page"]');
  above?.focus();
}

export function focusSearchField(): void {
  const field = document.querySelector<HTMLInputElement>('input[type="search"]');
  field?.focus();
  field?.select();
}

export function scrollCurrentListToTop(): void {
  const scroller = currentList()?.parentElement;
  if (scroller) scroller.scrollTop = 0;
}
