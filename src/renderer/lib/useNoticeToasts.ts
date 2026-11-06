import { useEffect } from 'react';
import type { Notice, NoticeAction } from '@shared/domain';
import { on } from '@/lib/api';
import { revealTrack } from '@/lib/libraryActions';
import { openSettings } from '@/lib/pages';
import { showToast } from '@/lib/toastStore';

function runAction(action: NoticeAction): void {
  switch (action.kind) {
    case 'reveal-track':
      revealTrack(action.trackId);
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
