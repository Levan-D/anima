import type { RevealTarget } from '@shared/domain';
import { call } from '@/lib/api';
import { showToast } from '@/lib/toastStore';

export function revealPath(target: RevealTarget): void {
  void call('system.revealPath', { target }).then((result) => {
    if (!result.ok) showToast({ message: result.error.message, level: 'error' });
  });
}
