import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { LibraryStatus } from '@shared/domain';
import { on } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { statusQuery } from '@/lib/libraryQueries';
import { resetNavigation } from '@/lib/navigation';
import { queryClient } from '@/lib/queryClient';
import { LIBRARY_DATA, queryKeys, scopeKey } from '@/lib/queryKeys';
import { showToast } from '@/lib/toastStore';

let lastReadyFolder: string | null = null;
let hasNotedOtherMachine = false;

function followFolder(status: LibraryStatus): void {
  if (status.state !== 'ready') return;
  if (lastReadyFolder !== null && lastReadyFolder !== status.folder) resetNavigation();
  lastReadyFolder = status.folder;
}

function noteOtherMachine(status: LibraryStatus): void {
  if (hasNotedOtherMachine || status.state !== 'ready' || !status.changedElsewhere || !status.lastChanged) return;
  hasNotedOtherMachine = true;
  const { host, at } = status.lastChanged;
  showToast({ message: `Library last changed on ${host}, ${formatDateTime(at)}` });
}

function openLibrary(status: LibraryStatus | undefined): string | null {
  return status?.state === 'ready' ? status.folder : null;
}

/**
 * The one way a new status gets in, from the event or from a command's reply. A status can mean a different database
 * than the cache was read from: another folder, or the same one after a restore or a rebuild.
 */
export function applyStatus(next: LibraryStatus): void {
  const previous = queryClient.getQueryData<LibraryStatus>(queryKeys.status);
  followFolder(next);
  if (openLibrary(previous) !== openLibrary(next)) {
    for (const queryKey of LIBRARY_DATA) queryClient.removeQueries({ queryKey });
  }
  queryClient.setQueryData(queryKeys.status, next);
}

/** The one place the cache hears from main. Nothing refetches unless something in here says so. */
export function useLibrarySync(): void {
  const { data: status } = useQuery(statusQuery);

  useEffect(() => {
    if (!status) return;
    followFolder(status);
    noteOtherMachine(status);
  }, [status]);

  useEffect(() => {
    const unsubscribers = [
      on('library.status', applyStatus),
      on('library.changed', ({ scopes }) => {
        for (const scope of scopes) void queryClient.invalidateQueries({ queryKey: scopeKey(scope) });
        // Its checks read every kind of data, so anything that changes can change a count.
        void queryClient.invalidateQueries({ queryKey: scopeKey('report') });
        // A playlist shows the library's tracks, so a scan marking one missing or retagging it changes what it shows.
        if (scopes.includes('library')) {
          void queryClient.invalidateQueries({ queryKey: scopeKey('playlists') });
          void queryClient.invalidateQueries({ queryKey: scopeKey('recommendations') });
        }
      }),
      on('scan.state', (state) => queryClient.setQueryData(queryKeys.scan, state)),
      on('data.state', (state) => queryClient.setQueryData(queryKeys.data, state)),
      on('settings.changed', (settings) => queryClient.setQueryData(queryKeys.settings, settings)),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, []);
}
