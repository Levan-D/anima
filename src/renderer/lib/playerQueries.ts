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

/**
 * Only the current track's is kept. Asking again is cheap, and a null from a request that was superseded mustn't stick. A
 * library change doesn't touch this: levels don't depend on anything the scan writes, and refetching would redraw them.
 */
export function waveformQuery(trackId: number | null) {
  return queryOptions({
    queryKey: queryKeys.waveform(trackId),
    queryFn: () => (trackId === null ? null : call('waveform.get', { trackId }).then(unwrap)),
    enabled: trackId !== null,
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
  });
}
