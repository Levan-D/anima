import { queryOptions, useMutation } from '@tanstack/react-query';
import type { Lyrics, LyricsImportReport } from '@shared/domain';
import { call, unwrap } from '@/lib/api';
import { formatPlural } from '@/lib/format';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { showToast } from '@/lib/toastStore';

/** Not kept: asking again the next time is how a failed lookup gets retried, and how a new .lrc gets noticed. */
export function lyricsQuery(trackId: number) {
  return queryOptions({
    queryKey: queryKeys.lyrics(trackId),
    queryFn: () => call('lyrics.get', { trackId }).then(unwrap),
    gcTime: 0,
  });
}

export function useSearchAgain(trackId: number) {
  return useMutation({
    mutationFn: () => call('lyrics.refresh', { trackId }).then(unwrap),
    onSuccess: (lyrics) => queryClient.setQueryData(queryKeys.lyrics(trackId), lyrics),
  });
}

/** Moves on screen now. What main stores comes back through `library.changed`. */
export function setLyricsOffset(trackId: number, offsetMs: number): void {
  queryClient.setQueryData<Lyrics>(queryKeys.lyrics(trackId), (lyrics) =>
    lyrics?.status === 'found' ? { ...lyrics, offsetMs } : lyrics,
  );
  void call('lyrics.setOffset', { trackId, offsetMs }).then((result) => {
    if (result.ok) return;
    showToast({ message: result.error.message, level: 'error' });
    void queryClient.invalidateQueries({ queryKey: queryKeys.lyrics(trackId) });
  });
}

function importWords({ matched, added, kept }: LyricsImportReport): string {
  if (matched === 0) return 'None of those lyrics belong to tracks in this library';
  const already = kept === 0 ? '' : `, ${kept} already had some`;
  return `Matched ${formatPlural(matched, 'track')}: ${added} added${already}`;
}

export function useImportLyrics() {
  return useMutation({
    mutationFn: () => call('lyrics.importLibrary').then(unwrap),
    onSuccess(report) {
      if (report !== null) showToast({ message: importWords(report) });
    },
    onError(error) {
      showToast({ message: error instanceof Error ? error.message : 'That did not work', level: 'error' });
    },
  });
}
