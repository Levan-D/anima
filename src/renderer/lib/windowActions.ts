import type { Result } from '@shared/result';
import { call } from '@/lib/api';
import { showToast } from '@/lib/toastStore';

function tellIfRefused(result: Result<unknown>): void {
  if (!result.ok) showToast({ message: result.error.message, level: 'error' });
}

export function setMiniPlayer(enabled: boolean): void {
  void call('window.setMiniPlayer', { enabled }).then(tellIfRefused);
}

export function toggleFullscreen(): void {
  void call('window.toggleFullscreen').then(tellIfRefused);
}
