/* What Settings' Data tab asks of main. How it's going comes back as `data.state`. */

import type { DatasetId } from '@shared/domain';
import type { Result } from '@shared/result';
import { call } from '@/lib/api';
import { showToast } from '@/lib/toastStore';

function tellIfRefused(result: Result<unknown>): void {
  if (!result.ok) showToast({ message: result.error.message, level: 'error' });
}

export function updateDataset(dataset: DatasetId): void {
  void call('data.update', { dataset }).then(tellIfRefused);
}

export function updateEverything(): void {
  void call('data.updateAll').then(tellIfRefused);
}

export function refreshListenerData(): void {
  void call('data.refreshListeners').then(tellIfRefused);
}

export function cancelDataset(dataset: DatasetId | null): void {
  void call('data.cancel', { dataset }).then(tellIfRefused);
}
