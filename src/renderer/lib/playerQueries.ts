import { queryOptions } from '@tanstack/react-query';
import { call, unwrap } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

/** Each version is its own entry, and an old one has no use: main only has the latest, and it can be megabytes. */
export function queueQuery(version: number) {
  return queryOptions({
    queryKey: queryKeys.queue(version),
    queryFn: () => call('player.queue').then(unwrap),
    gcTime: 0,
  });
}
