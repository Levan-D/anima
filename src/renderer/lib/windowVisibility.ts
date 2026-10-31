import { call, on } from '@/lib/api';

let hidden = false;
const listeners = new Set<() => void>();

function applyHidden(isHidden: boolean): void {
  document.documentElement.toggleAttribute('data-window-hidden', isHidden);
  if (isHidden === hidden) return;
  hidden = isHidden;
  for (const listener of listeners) listener();
}

/** For a loop run from script. CSS animations pause by themselves, through the attribute on the root. */
export function isWindowHidden(): boolean {
  return hidden;
}

export function onWindowHiddenChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function startWindowVisibilitySync(): void {
  on('window.state', ({ isHidden }) => applyHidden(isHidden));
  void call('window.state').then((result) => {
    if (result.ok) applyHidden(result.value.isHidden);
  });
}
