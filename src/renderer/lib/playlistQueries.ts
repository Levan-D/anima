import { queryOptions } from '@tanstack/react-query';
import { call, unwrap } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

export const playlistsQuery = queryOptions({
  queryKey: queryKeys.playlists,
  queryFn: () => call('playlist.list').then(unwrap),
});

export function playlistQuery(playlistId: number) {
  return queryOptions({
    queryKey: queryKeys.playlist(playlistId),
    queryFn: () => call('playlist.get', { playlistId }).then(unwrap),
  });
}
