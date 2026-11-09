/* Mood stations: what the tuner reads, and the commands that change them. What they change comes back through `library.changed`. */

import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type { CommandInput } from '@shared/ipc/contract';
import type { Result } from '@shared/result';
import type { MoodDraft, MoodGrade } from '@shared/stations';
import { call, unwrap } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { tellIfRefused } from '@/lib/toastStore';

export type MoodSettings = Omit<MoodDraft, 'name'>;
export type MoodTryInput = CommandInput<'moods.try'>;

export const moodCardsQuery = queryOptions({
  queryKey: queryKeys.moodCards,
  queryFn: () => call('moods.list').then(unwrap),
});

export function moodQuery(stationId: number) {
  return queryOptions({
    queryKey: queryKeys.mood(stationId),
    queryFn: () => call('moods.get', { stationId }).then(unwrap),
  });
}

export function moodSearchQuery(text: string) {
  return queryOptions({
    queryKey: queryKeys.moodSearch(text),
    queryFn: () => call('moods.search', { text }).then(unwrap),
  });
}

/**
 * Seconds of work the first time a draft's examples are tried. The last answer stays up while the next is worked out, so
 * what plays doesn't blank with every change. A try a newer one took over from fails as superseded, and nothing shows it.
 */
export function moodTryQuery(input: MoodTryInput) {
  return queryOptions({
    queryKey: queryKeys.moodTry(input),
    queryFn: () => call('moods.try', input).then(unwrap),
    placeholderData: keepPreviousData,
    gcTime: 60_000,
  });
}

/** Hiding each example in turn takes seconds each, told along the way in `moods.grading`. */
export function gradeMood(stationId: number | null, draft: MoodSettings): Promise<Result<MoodGrade>> {
  return call('moods.grade', { stationId, draft });
}

/** What went wrong is the tuner's to say, so this hands it back. */
export function saveMood(stationId: number | null, draft: MoodDraft): Promise<Result<{ stationId: number }>> {
  return call('moods.save', { stationId, draft });
}

export function deleteMood(stationId: number): void {
  void call('moods.delete', { stationId }).then(tellIfRefused);
}
