import { Disc3, ListEnd, ListStart, Play, UserRound } from 'lucide-react';
import type { Track } from '@shared/domain';
import type { MenuEntry } from '@/components/ui/menuEntries';
import { openAlbum, openArtist } from '@/lib/navigation';
import { enqueueTrack } from '@/lib/playerActions';

/** What a track row's menu offers. A list that's all one album leaves out going to it. */
export function trackMenuEntries(track: Track, onPlay: () => void, { isInAlbum }: { isInAlbum: boolean }): MenuEntry[] {
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
    ...(isInAlbum
      ? []
      : ([
          { kind: 'separator' },
          albumId === null
            ? { kind: 'item', label: 'Go to artist', icon: UserRound, onSelect: () => openArtist(artistId) }
            : { kind: 'item', label: 'Go to album', icon: Disc3, onSelect: () => openAlbum(albumId) },
        ] satisfies MenuEntry[])),
  ];
}
