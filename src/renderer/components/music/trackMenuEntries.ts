import { Disc3, FolderSearch, ListEnd, ListStart, Play, Radio, Sparkles, UserRound } from 'lucide-react';
import type { PlaylistSummary, Track } from '@shared/domain';
import { addToPlaylistEntry } from '@/components/music/addToPlaylistEntry';
import type { MenuEntry } from '@/components/ui/menuEntries';
import { formatPlural } from '@/lib/format';
import { revealTrack } from '@/lib/libraryActions';
import { openAlbum, openArtist, openSimilarToTrack } from '@/lib/navigation';
import { showPage } from '@/lib/pages';
import { enqueueTracks, playRadio, playTracks } from '@/lib/playerActions';

/** Good on any track, wherever it's listed, whether it's on this device or not. */
export function trackFileEntries(track: Track, playlists: readonly PlaylistSummary[]): MenuEntry[] {
  return [
    addToPlaylistEntry([track.id], playlists),
    { kind: 'item', label: 'Reveal in File Explorer', icon: FolderSearch, onSelect: () => revealTrack(track.id) },
  ];
}

/** Play, Play next and Add to queue, for what can be played of these. */
function playEntries(tracks: readonly Track[], onPlay: () => void): MenuEntry[] {
  const cantPlay = tracks.length === 0;
  return [
    { kind: 'item', label: 'Play', icon: Play, disabled: cantPlay, onSelect: onPlay },
    {
      kind: 'item',
      label: 'Play next',
      icon: ListStart,
      disabled: cantPlay,
      onSelect: () => enqueueTracks(tracks, 'next'),
    },
    {
      kind: 'item',
      label: 'Add to queue',
      icon: ListEnd,
      disabled: cantPlay,
      onSelect: () => enqueueTracks(tracks, 'after-added'),
    },
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
    ...playEntries(cantPlay ? [] : [track], onPlay),
    { kind: 'separator' },
    {
      kind: 'item',
      label: 'More like this',
      icon: Sparkles,
      onSelect: () => openSimilarToTrack(track.id, track.title),
    },
    {
      kind: 'item',
      label: 'Radio from this track',
      icon: Radio,
      disabled: cantPlay,
      onSelect: () => {
        playRadio(track.id);
        showPage('radio');
      },
    },
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
  return [
    { kind: 'label', label: formatPlural(tracks.length, 'track') },
    ...playEntries(playable, () => playTracks(playable)),
    { kind: 'separator' },
    addToPlaylistEntry(
      tracks.map(({ id }) => id),
      playlists,
    ),
  ];
}
