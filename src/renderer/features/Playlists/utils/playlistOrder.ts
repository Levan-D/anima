import type { PlaylistItem } from '@shared/domain';

export function playableItems(items: readonly PlaylistItem[]): PlaylistItem[] {
  return items.filter(({ track }) => !track.isMissing);
}
