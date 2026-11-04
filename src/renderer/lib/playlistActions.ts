/* Commands to the playlists. What they change comes back through `library.changed`, so nothing here touches the cache. */

import { create } from 'zustand';
import type { PlaylistSummary } from '@shared/domain';
import type { Result } from '@shared/result';
import { call } from '@/lib/api';
import { formatPlural } from '@/lib/format';
import { showToast } from '@/lib/toastStore';

function tellIfRefused(result: Result<unknown>): void {
  if (!result.ok) showToast({ message: result.error.message, level: 'error' });
}

/** A name that's taken is the dialog's to say, so these two hand back what happened. */
export function createPlaylist(name: string, trackIds: number[]): Promise<Result<PlaylistSummary>> {
  return call('playlist.create', { name, trackIds });
}

export function renamePlaylist(playlistId: number, name: string): Promise<Result<void>> {
  return call('playlist.rename', { playlistId, name });
}

/** For the editor, which says itself what went wrong. */
export function addTracksToPlaylist(playlistId: number, trackIds: number[]): Promise<Result<{ added: number }>> {
  return call('playlist.addTracks', { playlistId, trackIds, index: null });
}

export function removeItemsFromPlaylist(playlistId: number, itemIds: number[]): Promise<Result<void>> {
  return call('playlist.removeItems', { playlistId, itemIds });
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

export function removeFromPlaylist(playlistId: number, itemIds: number[]): void {
  void call('playlist.removeItems', { playlistId, itemIds }).then(tellIfRefused);
}

export function movePlaylistItems(playlistId: number, itemIds: number[], toIndex: number): void {
  void call('playlist.moveItems', { playlistId, itemIds, toIndex }).then(tellIfRefused);
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
