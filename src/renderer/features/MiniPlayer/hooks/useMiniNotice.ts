import { useEffect } from 'react';
import { dismissToast, TOAST_DURATION_MS, useToasts, type Toast } from '@/lib/toastStore';
import { useNoticeToasts } from '@/lib/useNoticeToasts';

/**
 * The main window is out of sight while the mini is open, so its toasts wouldn't be seen, and this window has no room
 * for any. The newest one is what the mini says for as long as a toast would last. Its action waits in the main window.
 */
export function useMiniNotice(): Toast | null {
  useNoticeToasts();
  const newest = useToasts().findLast(({ open }) => open) ?? null;
  const id = newest?.id ?? null;

  useEffect(() => {
    if (id === null) return;
    const timer = setTimeout(() => dismissToast(id), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [id]);

  return newest;
}
