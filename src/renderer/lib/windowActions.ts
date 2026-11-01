import type { Result } from '@shared/result';
import { call } from '@/lib/api';
import { closeQueueSheet, isQueueSheetOpen } from '@/lib/queueSheet';
import { clearSelection } from '@/lib/selection';
import { showToast } from '@/lib/toastStore';

function tellIfRefused(result: Result<unknown>): void {
  if (!result.ok) showToast({ message: result.error.message, level: 'error' });
}

export function setMiniPlayer(enabled: boolean): void {
  void call('window.setMiniPlayer', { enabled }).then(tellIfRefused);
}

/** What going back means in the mini: a selection goes first, then the queue, then the mini itself. */
export function backInMini(): void {
  if (clearSelection()) return;
  if (isQueueSheetOpen()) closeQueueSheet();
  else setMiniPlayer(false);
}

export function toggleFullscreen(): void {
  void call('window.toggleFullscreen').then(tellIfRefused);
}
