/* What Settings' Data tab asks of main. How it's going comes back as `data.state`. */

import type { DatasetId } from '@shared/domain';
import { call } from '@/lib/api';
import { tellIfRefused } from '@/lib/toastStore';

export function updateDataset(dataset: DatasetId): void {
  void call('data.update', { dataset }).then(tellIfRefused);
}

export function updateEverything(): void {
  void call('data.updateAll').then(tellIfRefused);
}

export function cancelDataset(dataset: DatasetId | null): void {
  void call('data.cancel', { dataset }).then(tellIfRefused);
}
