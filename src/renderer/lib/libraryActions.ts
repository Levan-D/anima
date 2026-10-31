import { useMutation } from '@tanstack/react-query';
import type { LibraryStatus } from '@shared/domain';
import { call, unwrap } from '@/lib/api';
import { formatPlural } from '@/lib/format';
import { resetNavigation } from '@/lib/navigation';
import { showToast } from '@/lib/toastStore';
import { applyStatus } from '@/lib/useLibrarySync';

function toastFailure(error: unknown): void {
  showToast({ message: error instanceof Error ? error.message : 'That did not work', level: 'error' });
}

/** Opens the nearest folder that's still there, when the file itself isn't. */
export function revealTrack(trackId: number): void {
  void call('system.revealTrack', { trackId }).then((result) => {
    if (!result.ok) showToast({ message: result.error.message, level: 'error' });
  });
}

export function useChooseFolder() {
  return useMutation({
    mutationFn: () => call('library.chooseFolder').then(unwrap),
    onSuccess: applyStatus,
    onError: toastFailure,
  });
}

const STILL_A_PROBLEM: Partial<Record<LibraryStatus['state'], string>> = {
  'folder-missing': "That folder still isn't there",
  'not-writable': "That folder still can't be written to",
  'db-corrupt': "The library's database still can't be opened",
  'db-too-new': "The library's database still needs a newer version of the app",
};

/** Trying again and getting the same answer changes nothing on screen, so it has to be said. */
function sayIfStillAProblem(status: LibraryStatus): void {
  const message = STILL_A_PROBLEM[status.state];
  if (message) showToast({ message, level: 'warning' });
}

export function useRetryOpen() {
  return useMutation({
    mutationFn: () => call('library.retryOpen').then(unwrap),
    onSuccess(status) {
      applyStatus(status);
      sayIfStillAProblem(status);
    },
    onError: toastFailure,
  });
}

/** After this and a rebuild the ids aren't the ones the navigation holds, even though the folder is the same. */
export function useRestoreBackup() {
  return useMutation({
    mutationFn: () => call('library.restoreBackup').then(unwrap),
    onSuccess(status) {
      applyStatus(status);
      resetNavigation();
      sayIfStillAProblem(status);
    },
    onError: toastFailure,
  });
}

export function useRebuild() {
  return useMutation({
    mutationFn: () => call('library.rebuild').then(unwrap),
    onSuccess(status) {
      applyStatus(status);
      resetNavigation();
    },
    onError: toastFailure,
  });
}

export function useRescan() {
  return useMutation({
    mutationFn: () => call('scan.start').then(unwrap),
    onError: toastFailure,
  });
}

export function useCancelScan() {
  return useMutation({
    mutationFn: () => call('scan.cancel').then(unwrap),
    onError: toastFailure,
  });
}

export function useRemoveMissing() {
  return useMutation({
    mutationFn: () => call('library.removeMissing').then(unwrap),
    onSuccess: ({ removed }) => showToast({ message: `Removed ${formatPlural(removed, 'missing track')}` }),
    onError: toastFailure,
  });
}
