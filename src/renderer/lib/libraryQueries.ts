import { queryOptions, useQuery } from '@tanstack/react-query';
import type { TrackFilter } from '@shared/domain';
import { call, unwrap } from '@/lib/api';
import { queryKeys, type AlbumFilter, type SimilarSource } from '@/lib/queryKeys';

const SEARCH_CACHE_MS = 60_000;

export const statusQuery = queryOptions({
  queryKey: queryKeys.status,
  queryFn: () => call('library.status').then(unwrap),
});

export const scanQuery = queryOptions({
  queryKey: queryKeys.scan,
  queryFn: () => call('scan.state').then(unwrap),
});

export const settingsQuery = queryOptions({
  queryKey: queryKeys.settings,
  queryFn: () => call('settings.get').then(unwrap),
});

export const statsQuery = queryOptions({
  queryKey: queryKeys.stats,
  queryFn: () => call('stats.summary').then(unwrap),
});

export const artistsQuery = queryOptions({
  queryKey: queryKeys.artists,
  queryFn: () => call('library.artists').then(unwrap),
});

export function artistsInGenreQuery(genreId: number) {
  return queryOptions({
    queryKey: queryKeys.artistsInGenre(genreId),
    queryFn: () => call('library.artistsInGenre', { genreId }).then(unwrap),
  });
}

export function artistQuery(artistId: number) {
  return queryOptions({
    queryKey: queryKeys.artist(artistId),
    queryFn: () => call('library.artist', { artistId }).then(unwrap),
  });
}

export function albumsQuery(filter: AlbumFilter) {
  return queryOptions({
    queryKey: queryKeys.albums(filter),
    queryFn: () => call('library.albums', filter).then(unwrap),
  });
}

export function albumQuery(albumId: number) {
  return queryOptions({
    queryKey: queryKeys.album(albumId),
    queryFn: () => call('library.album', { albumId }).then(unwrap),
  });
}

export const genresQuery = queryOptions({
  queryKey: queryKeys.genres,
  queryFn: () => call('library.genres').then(unwrap),
});

export function tracksQuery(filter: TrackFilter) {
  return queryOptions({
    queryKey: queryKeys.tracks(filter),
    queryFn: () => call('library.tracks', { filter }).then(unwrap),
  });
}

export function searchQuery(query: string) {
  return queryOptions({
    queryKey: queryKeys.search(query),
    queryFn: () => call('library.search', { query }).then(unwrap),
    // Every keystroke is its own query, while the rest of the cache keeps what it reads for good.
    gcTime: SEARCH_CACHE_MS,
  });
}

export const issuesQuery = queryOptions({
  queryKey: queryKeys.issues,
  queryFn: () => call('scan.issues').then(unwrap),
});

export const storageQuery = queryOptions({
  queryKey: queryKeys.storage,
  queryFn: () => call('system.storageInfo').then(unwrap),
});

export function similarQuery(source: SimilarSource) {
  return queryOptions({
    queryKey: queryKeys.similar(source),
    queryFn: () =>
      (source.kind === 'track'
        ? call('recommend.similarToTrack', { trackId: source.trackId })
        : call('recommend.similarToPlaylist', { playlistId: source.playlistId })
      ).then(unwrap),
  });
}

export const discoverQuery = queryOptions({
  queryKey: queryKeys.discover,
  queryFn: () => call('recommend.discover').then(unwrap),
});

export function discoverDetailQuery(key: string) {
  return queryOptions({
    queryKey: queryKeys.discoverDetail(key),
    queryFn: () => call('recommend.discoverDetail', { key }).then(unwrap),
  });
}

export const dataStateQuery = queryOptions({
  queryKey: queryKeys.data,
  queryFn: () => call('data.state').then(unwrap),
  // What other things changed since is only counted when asked.
  refetchOnMount: 'always',
});

export function useIsScanning(): boolean {
  const { data = false } = useQuery({ ...scanQuery, select: ({ phase }) => phase !== 'idle' });
  return data;
}

/** The folder has nothing in it, and no scan is about to change that, which takes knowing that none is running. */
export function useHasNoMusic(): boolean {
  const { data: isIdle = false } = useQuery({ ...scanQuery, select: ({ phase }) => phase === 'idle' });
  const { data: isEmpty = false } = useQuery({
    ...statusQuery,
    select: (status) => status.state === 'ready' && status.isEmpty,
  });
  return isEmpty && isIdle;
}
