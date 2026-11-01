import { useEffect } from 'react';
import type { Notice, NoticeAction } from '@shared/domain';
import type { Result } from '@shared/result';
import { call, on } from '@/lib/api';
import { openSettings } from '@/lib/pages';
import { showToast } from '@/lib/toastStore';

function reportFailure(result: Result<void>): void {
  if (!result.ok) showToast({ message: result.error.message, level: 'error' });
}

function runAction(action: NoticeAction): void {
  switch (action.kind) {
    case 'reveal-track':
      void call('system.revealTrack', { trackId: action.trackId }).then(reportFailure);
      return;
    case 'open-storage':
      openSettings('library');
  }
}

function showNotice({ level, message, action }: Notice): void {
  showToast({
    message,
    level,
    ...(action ? { action: { label: action.label, run: () => runAction(action) } } : {}),
  });
}

export function useNoticeToasts(): void {
  useEffect(() => on('notice', showNotice), []);
}
