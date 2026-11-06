import { call } from '@/lib/api';
import { tellIfRefused } from '@/lib/toastStore';

export function setMiniPlayer(enabled: boolean): void {
  void call('window.setMiniPlayer', { enabled }).then(tellIfRefused);
}

/** The mini has nothing to go back through, so going back leaves it. */
export function backInMini(): void {
  setMiniPlayer(false);
}

export function toggleFullscreen(): void {
  void call('window.toggleFullscreen').then(tellIfRefused);
}
