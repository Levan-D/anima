import type { Track } from '@shared/domain';

/** How many a picker offers at once. */
export const PICKS_SHOWN = 10;
/** As tall as every pick, so the list doesn't change height between suggestions and a search. */
export const PICK_LIST = 'h-[calc(var(--spacing-row)*10)] overflow-y-auto';

/** What's on this device, which is all radio can start from. */
export function owned(tracks: Track[]): Track[] {
  return tracks.filter(({ isMissing }) => !isMissing);
}
