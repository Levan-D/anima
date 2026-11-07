/* What a list is made of, and how it comes apart into rows the virtualizer can place. */

import type {
  AlbumSummary,
  ArtistSummary,
  GenreSummary,
  PlaylistItem,
  PlaylistSummary,
  QueueItem,
  Track,
} from '@shared/domain';

export type MusicSection =
  | { kind: 'label'; text: string }
  /** A grid of album cards. */
  | { kind: 'albums'; albums: AlbumSummary[]; hideArtist: boolean }
  | { kind: 'albumRows'; albums: AlbumSummary[] }
  | { kind: 'artists'; artists: ArtistSummary[] }
  | { kind: 'genres'; genres: GenreSummary[] }
  | { kind: 'playlists'; playlists: PlaylistSummary[] }
  | { kind: 'tracks'; tracks: Track[]; numbered: boolean }
  /** One album's run of a long list, foobar2000 style: a heading line, then one tight line for each track. */
  | { kind: 'albumGroup'; heading: string; tracks: Track[] }
  /** The queue, where the same track can be twice, so a row is its place and not its track. */
  | { kind: 'queue'; items: QueueItem[] }
  /** A playlist's items, which also can be the same track twice. Read-only: the editor does the reordering. */
  | { kind: 'playlistItems'; items: PlaylistItem[] };

export type MusicItem =
  | { kind: 'label'; key: string; text: string }
  | { kind: 'albumHeading'; key: string; text: string }
  | { kind: 'albumLane'; key: string; albums: AlbumSummary[]; lanes: number; hideArtist: boolean }
  | { kind: 'albumRow'; key: string; album: AlbumSummary }
  | { kind: 'artist'; key: string; artist: ArtistSummary }
  | { kind: 'genre'; key: string; genre: GenreSummary }
  | { kind: 'playlist'; key: string; playlist: PlaylistSummary }
  | {
      kind: 'track';
      key: string;
      track: Track;
      numbered: boolean;
      queueIndex: number | null;
      /** What a drag calls this row. Null when it can't be picked up. */
      dragId: number | null;
      /** One line under an album heading, rather than art and two lines. */
      tight: boolean;
    };

export type TrackItem = Extract<MusicItem, { kind: 'track' }>;

// A row's key is its place, not what's in it. While a scan adds albums they shift along the rows, and most of the cards
// on screen stay in the row they were in, without being remounted and reloading their art.
function albumLanes(albums: AlbumSummary[], lanes: number, hideArtist: boolean, section: number): MusicItem[] {
  const rows: MusicItem[] = [];
  for (let start = 0; start < albums.length; start += lanes) {
    const row = albums.slice(start, start + lanes);
    rows.push({ kind: 'albumLane', key: `lane-${section}-${start}`, albums: row, lanes, hideArtist });
  }
  return rows;
}

export function toMusicItems(sections: readonly MusicSection[], lanes: number): MusicItem[] {
  return sections.flatMap((section, position): MusicItem[] => {
    switch (section.kind) {
      case 'label':
        return [{ kind: 'label', key: `label-${position}`, text: section.text }];
      case 'albums':
        return albumLanes(section.albums, lanes, section.hideArtist, position);
      case 'albumRows':
        return section.albums.map((album) => ({ kind: 'albumRow', key: `album-${album.id}`, album }));
      case 'artists':
        return section.artists.map((artist) => ({ kind: 'artist', key: `artist-${artist.id}`, artist }));
      case 'genres':
        return section.genres.map((genre) => ({ kind: 'genre', key: `genre-${genre.id}`, genre }));
      case 'playlists':
        return section.playlists.map((playlist) => ({ kind: 'playlist', key: `playlist-${playlist.id}`, playlist }));
      case 'tracks':
        return section.tracks.map((track) => ({
          kind: 'track',
          key: `track-${track.id}`,
          track,
          numbered: section.numbered,
          queueIndex: null,
          dragId: null,
          tight: false,
        }));
      case 'albumGroup':
        return [
          { kind: 'albumHeading', key: `heading-${position}`, text: section.heading },
          ...section.tracks.map((track): MusicItem => ({
            kind: 'track',
            key: `track-${track.id}`,
            track,
            numbered: false,
            queueIndex: null,
            dragId: null,
            tight: true,
          })),
        ];
      case 'queue':
        return section.items.map(({ queueId, track }, queueIndex) => ({
          kind: 'track',
          key: `queue-${queueId}`,
          track,
          numbered: false,
          queueIndex,
          dragId: queueId,
          tight: false,
        }));
      case 'playlistItems':
        return section.items.map(({ itemId, track }) => ({
          kind: 'track',
          key: `item-${itemId}`,
          track,
          numbered: false,
          queueIndex: null,
          dragId: null,
          tight: false,
        }));
    }
  });
}

export function focusableIn(item: MusicItem): number {
  if (item.kind === 'label' || item.kind === 'albumHeading') return 0;
  return item.kind === 'albumLane' ? item.albums.length : 1;
}

export function keyOf(item: MusicItem): string {
  return item.key;
}

/** Unlike a lane's own key, this stays the same when an album moves to another lane. */
export function cellKeyOf(item: MusicItem, column: number): string {
  return item.kind === 'albumLane' ? `album-${item.albums[column]?.id}` : item.key;
}

/** The rows a drag can move or drop between, in order. */
export function dragIdsOf(items: readonly MusicItem[]): number[] {
  return items.flatMap((item) => (item.kind === 'track' && item.dragId !== null ? [item.dragId] : []));
}

/** What goes along when this row is picked up: the whole selection if it's in it, and only what can be dragged. */
export function draggedWith(items: readonly MusicItem[], selected: ReadonlySet<string>, dragId: number): number[] {
  const pressed = items.find((item) => item.kind === 'track' && item.dragId === dragId);
  if (pressed === undefined || !selected.has(pressed.key)) return [dragId];
  return dragIdsOf(items.filter(({ key }) => selected.has(key)));
}
