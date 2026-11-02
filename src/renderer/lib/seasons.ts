/* Seasonal themes from the renderer's side: what's in them, and saying what belongs where. */

import { queryOptions } from '@tanstack/react-query';
import type { Seasons, ThemeMark } from '@shared/themes';
import type { CommandInput } from '@shared/ipc/contract';
import { call, unwrap } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { showToast, type ToastAction } from '@/lib/toastStore';

export const themeContentsQuery = queryOptions({
  queryKey: queryKeys.themeContents,
  queryFn: () => call('seasons.contents').then(unwrap),
});

export type ThemeTarget = CommandInput<'seasons.mark'>['target'];

export function saveSeasons(seasons: Seasons): Promise<void> {
  return call('seasons.set', { seasons }).then((result) => {
    if (!result.ok) {
      showToast({ message: result.error.message, level: 'error' });
      return;
    }
    void queryClient.invalidateQueries({ queryKey: queryKeys.radioPreviews });
  });
}

/** Says so either way, since nothing else on screen changes when it's done from a list. */
export function markTheme(target: ThemeTarget, mark: ThemeMark, message: string, undo?: ToastAction): void {
  void call('seasons.mark', { target, mark }).then((result) => {
    if (!result.ok) {
      showToast({ message: result.error.message, level: 'error' });
      return;
    }
    showToast({ message, ...(undo === undefined ? {} : { action: undo }) });
  });
}
