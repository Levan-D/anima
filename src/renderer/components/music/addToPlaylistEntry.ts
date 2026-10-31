import { ListMusic, ListPlus, Plus } from 'lucide-react';
import type { PlaylistSummary } from '@shared/domain';
import type { MenuEntry } from '@/components/ui/menuEntries';
import { addToPlaylist, askForNewPlaylist } from '@/lib/playlistActions';

export function addToPlaylistEntry(trackIds: number[], playlists: readonly PlaylistSummary[]): MenuEntry {
  return {
    kind: 'submenu',
    label: 'Add to playlist',
    icon: ListPlus,
    entries: [
      { kind: 'item', label: 'New playlist…', icon: Plus, onSelect: () => askForNewPlaylist(trackIds) },
      ...(playlists.length === 0 ? [] : ([{ kind: 'separator' }] satisfies MenuEntry[])),
      ...playlists.map((playlist): MenuEntry => ({
        kind: 'item',
        label: playlist.name,
        icon: ListMusic,
        onSelect: () => addToPlaylist(playlist, trackIds),
      })),
    ],
  };
}
