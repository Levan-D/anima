import { call, on } from '@/lib/api';

function applyHidden(isHidden: boolean): void {
  document.documentElement.toggleAttribute('data-window-hidden', isHidden);
}

export function startWindowVisibilitySync(): void {
  on('window.state', ({ isHidden }) => applyHidden(isHidden));
  void call('window.state').then((result) => {
    if (result.ok) applyHidden(result.value.isHidden);
  });
}
