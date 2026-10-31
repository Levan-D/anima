/* What a list is made of, and how it comes apart into rows the virtualizer can place. */

import type { AlbumSummary, ArtistSummary, GenreSummary, QueueItem, Track } from '@shared/domain';

export type MusicSection =
  | { kind: 'label'; text: string }
  /** A grid of album cards. */
  | { kind: 'albums'; albums: AlbumSummary[]; hideArtist: boolean }
  | { kind: 'albumRows'; albums: AlbumSummary[] }
  | { kind: 'artists'; artists: ArtistSummary[] }
  | { kind: 'genres'; genres: GenreSummary[] }
  | { kind: 'tracks'; tracks: Track[]; numbered: boolean }
  /** The queue, where the same track can be twice, so a row is its place and not its track. */
  | { kind: 'queue'; items: QueueItem[] };

export type MusicItem =
  | { kind: 'label'; key: string; text: string }
  | { kind: 'albumLane'; key: string; albums: AlbumSummary[]; lanes: number; hideArtist: boolean }
  | { kind: 'albumRow'; key: string; album: AlbumSummary }
  | { kind: 'artist'; key: string; artist: ArtistSummary }
  | { kind: 'genre'; key: string; genre: GenreSummary }
  | { kind: 'track'; key: string; track: Track; numbered: boolean; queueIndex: number | null };

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
      case 'tracks':
        return section.tracks.map((track) => ({
          kind: 'track',
          key: `track-${track.id}`,
          track,
          numbered: section.numbered,
          queueIndex: null,
        }));
      case 'queue':
        return section.items.map(({ queueId, track }, queueIndex) => ({
          kind: 'track',
          key: `queue-${queueId}`,
          track,
          numbered: false,
          queueIndex,
        }));
    }
  });
}

export function focusableIn(item: MusicItem): number {
  if (item.kind === 'label') return 0;
  return item.kind === 'albumLane' ? item.albums.length : 1;
}

export function keyOf(item: MusicItem): string {
  return item.key;
}

/** Unlike a lane's own key, this stays the same when an album moves to another lane. */
export function cellKeyOf(item: MusicItem, column: number): string {
  return item.kind === 'albumLane' ? `album-${item.albums[column]?.id}` : item.key;
}
