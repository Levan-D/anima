/* Commands to the playlists. What they change comes back through `library.changed`, so nothing here touches the cache. */

import { create } from 'zustand';
import type { PlaylistSummary } from '@shared/domain';
import type { Result } from '@shared/result';
import { call } from '@/lib/api';
import { formatPlural } from '@/lib/format';
import { showToast, tellIfRefused } from '@/lib/toastStore';

/** A name that's taken is the dialog's to say, so these two hand back what happened. */
export function createPlaylist(name: string, trackIds: number[]): Promise<Result<PlaylistSummary>> {
  return call('playlist.create', { name, trackIds });
}

/** The editor's save, in one go. A name that's taken is the editor's to say. */
export function savePlaylist(playlistId: number, name: string, trackIds: number[]): Promise<Result<void>> {
  return call('playlist.save', { playlistId, name, trackIds });
}

export function exportPlaylist(playlistId: number, name: string): void {
  void call('playlist.export', { playlistId }).then((result) => {
    tellIfRefused(result);
    if (result.ok && result.value) showToast({ message: `Exported ${name}` });
  });
}

/** Opens what it made. Lines it couldn't find in this library are counted, so nothing goes missing silently. */
export function importPlaylist(onImported: (playlistId: number) => void): void {
  void call('playlist.import').then((result) => {
    tellIfRefused(result);
    if (!result.ok || result.value === null) return;
    const { playlistId, name, matched, total } = result.value;
    const skipped = total - matched;
    showToast({
      message:
        skipped === 0
          ? `Imported ${name}`
          : `Imported ${name}. ${formatPlural(skipped, 'song')} in the file aren't in this library`,
      level: skipped === 0 ? 'info' : 'warning',
    });
    onImported(playlistId);
  });
}

export function deletePlaylist(playlistId: number): void {
  void call('playlist.delete', { playlistId }).then(tellIfRefused);
}

function addedWords(added: number, asked: number, name: string): string {
  if (added === 0) return `Already in ${name}`;
  const words = `Added ${formatPlural(added, 'track')} to ${name}`;
  return added === asked ? words : `${words}. ${asked - added} already there`;
}

export function addToPlaylist({ id, name }: PlaylistSummary, trackIds: number[]): void {
  void call('playlist.addTracks', { playlistId: id, trackIds, index: null }).then((result) => {
    tellIfRefused(result);
    if (result.ok) showToast({ message: addedWords(result.value.added, trackIds.length, name) });
  });
}

export function removeMissingFromPlaylist(playlistId: number): void {
  void call('playlist.removeMissing', { playlistId }).then((result) => {
    tellIfRefused(result);
    if (result.ok) showToast({ message: `Removed ${formatPlural(result.value.removed, 'missing track')}` });
  });
}

type NewPlaylistPrompt = {
  /** What the new playlist starts with. Null while nobody's being asked for a name. */
  trackIds: number[] | null;
};

const useNewPlaylistPromptStore = create<NewPlaylistPrompt>()(() => ({ trackIds: null }));

export function useNewPlaylistPrompt(): number[] | null {
  return useNewPlaylistPromptStore((state) => state.trackIds);
}

/** Opens the one name dialog, from anywhere. A menu item can't hold a dialog: it's gone as soon as it's chosen. */
export function askForNewPlaylist(trackIds: number[]): void {
  useNewPlaylistPromptStore.setState({ trackIds });
}

export function closeNewPlaylistPrompt(): void {
  useNewPlaylistPromptStore.setState({ trackIds: null });
}
