import { Disc3, FolderSearch, ListEnd, ListStart, Play, UserRound } from 'lucide-react';
import type { PlaylistSummary, Track } from '@shared/domain';
import { addToPlaylistEntry } from '@/components/music/addToPlaylistEntry';
import type { MenuEntry } from '@/components/ui/menuEntries';
import { revealTrack } from '@/lib/libraryActions';
import { openAlbum, openArtist } from '@/lib/navigation';
import { enqueueTrack } from '@/lib/playerActions';

/** Good on any track, wherever it's listed, whether it's on this device or not. */
export function trackFileEntries(track: Track, playlists: readonly PlaylistSummary[]): MenuEntry[] {
  return [
    addToPlaylistEntry([track.id], playlists),
    { kind: 'item', label: 'Reveal in File Explorer', icon: FolderSearch, onSelect: () => revealTrack(track.id) },
  ];
}

/** What a track row's menu offers. A list that's all one album leaves out going to it. */
export function trackMenuEntries(
  track: Track,
  onPlay: () => void,
  { isInAlbum }: { isInAlbum: boolean },
  playlists: readonly PlaylistSummary[],
): MenuEntry[] {
  const cantPlay = track.isMissing;
  const { albumId, artistId } = track;
  return [
    { kind: 'item', label: 'Play', icon: Play, disabled: cantPlay, onSelect: onPlay },
    {
      kind: 'item',
      label: 'Play next',
      icon: ListStart,
      disabled: cantPlay,
      onSelect: () => enqueueTrack(track, 'next'),
    },
    {
      kind: 'item',
      label: 'Add to queue',
      icon: ListEnd,
      disabled: cantPlay,
      onSelect: () => enqueueTrack(track, 'end'),
    },
    { kind: 'separator' },
    ...trackFileEntries(track, playlists),
    ...(isInAlbum
      ? []
      : ([
          albumId === null
            ? { kind: 'item', label: 'Go to artist', icon: UserRound, onSelect: () => openArtist(artistId) }
            : { kind: 'item', label: 'Go to album', icon: Disc3, onSelect: () => openAlbum(albumId) },
        ] satisfies MenuEntry[])),
  ];
}
