import { existsSync } from 'node:fs';
import type { LibraryStatus } from '@shared/domain';
import { ok } from '@shared/result';
import type { HandlerGroup } from '@main/ipc';
import type { SettingsStore } from '@main/settings/settings';

/** A stub until the database exists: it only knows what the settings and the disk can say. */
export function libraryStatus(folder: string | null): LibraryStatus {
  if (folder === null) return { state: 'no-folder' };
  if (!existsSync(folder)) return { state: 'folder-missing', folder };
  return { state: 'ready', folder, isEmpty: true, lastChanged: null, changedElsewhere: false };
}

export function libraryHandlers(settings: SettingsStore) {
  return {
    'library.status': () => ok(libraryStatus(settings.get().libraryFolder)),
  } satisfies HandlerGroup;
}
