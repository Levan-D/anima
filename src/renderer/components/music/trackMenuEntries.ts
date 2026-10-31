import { Disc3, FolderSearch, ListEnd, ListStart, Play, UserRound } from 'lucide-react';
import type { PlaylistSummary, Track } from '@shared/domain';
import { addToPlaylistEntry } from '@/components/music/addToPlaylistEntry';
import type { MenuEntry } from '@/components/ui/menuEntries';
import { formatPlural } from '@/lib/format';
import { revealTrack } from '@/lib/libraryActions';
import { openAlbum, openArtist } from '@/lib/navigation';
import { enqueueTracks, playTracks } from '@/lib/playerActions';

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
      onSelect: () => enqueueTracks([track], 'next'),
    },
    {
      kind: 'item',
      label: 'Add to queue',
      icon: ListEnd,
      disabled: cantPlay,
      onSelect: () => enqueueTracks([track], 'end'),
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

/** The menu of a row in a selection. What only makes sense for one track isn't here. */
export function selectionMenuEntries(tracks: readonly Track[], playlists: readonly PlaylistSummary[]): MenuEntry[] {
  const playable = tracks.filter(({ isMissing }) => !isMissing);
  const cantPlay = playable.length === 0;
  return [
    { kind: 'label', label: formatPlural(tracks.length, 'track') },
    { kind: 'item', label: 'Play', icon: Play, disabled: cantPlay, onSelect: () => playTracks(playable) },
    {
      kind: 'item',
      label: 'Play next',
      icon: ListStart,
      disabled: cantPlay,
      onSelect: () => enqueueTracks(playable, 'next'),
    },
    {
      kind: 'item',
      label: 'Add to queue',
      icon: ListEnd,
      disabled: cantPlay,
      onSelect: () => enqueueTracks(playable, 'end'),
    },
    { kind: 'separator' },
    addToPlaylistEntry(
      tracks.map(({ id }) => id),
      playlists,
    ),
  ];
}
