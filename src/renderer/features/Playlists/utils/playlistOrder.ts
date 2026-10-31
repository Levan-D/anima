import type { PlaylistItem } from '@shared/domain';

export function playableItems(items: readonly PlaylistItem[]): PlaylistItem[] {
  return items.filter(({ track }) => !track.isMissing);
}

/**
 * The screen only reorders the playable rows, while the stored order has the missing ones between them, for when they
 * come back. This takes a place among the playable rows, without the moving ones, and gives the place in the stored
 * order, without them too: right before the playable row it's to land above, or right after the last one.
 */
export function placeInPlaylist(items: readonly PlaylistItem[], moving: readonly number[], toIndex: number): number {
  const wanted = new Set(moving);
  const rest = items.filter(({ itemId }) => !wanted.has(itemId));
  const playable = playableItems(rest);

  const landsAbove = playable[toIndex];
  if (landsAbove !== undefined) return rest.indexOf(landsAbove);
  const last = playable.at(-1);
  return last === undefined ? 0 : rest.indexOf(last) + 1;
}
