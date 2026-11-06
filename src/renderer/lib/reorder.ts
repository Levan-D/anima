/* What a drag over a list means, in numbers. */

export type RowPlace = {
  index: number;
  /** Its place among the rows that aren't moving. */
  rank: number;
};

export function placesOf(ids: readonly number[], moving: ReadonlySet<number>): Map<number, RowPlace> {
  const places = new Map<number, RowPlace>();
  let rank = 0;
  for (const [index, id] of ids.entries()) {
    places.set(id, { index, rank });
    if (!moving.has(id)) rank++;
  }
  return places;
}

/** Which slot among the rows that stay a lifted row is over, `offset` below the top of the first. Rows are one height. */
export function slotAt(offset: number, rowHeight: number, restCount: number): number {
  return Math.min(Math.max(Math.round(offset / rowHeight), 0), restCount);
}

/** Where a row that stays sits, counted in rows, with a gap for `movingCount` of them opened at `slot`. */
export function restingPlace(rank: number, slot: number, movingCount: number): number {
  return rank < slot ? rank : rank + movingCount;
}

/** How hard an edge pulls on the scroll, from -1 at the top to 1 at the bottom. It starts gently and gathers speed. */
export function edgePull(y: number, top: number, bottom: number, zone: number): number {
  const up = Math.min(Math.max((top + zone - y) / zone, 0), 1);
  const down = Math.min(Math.max((y - (bottom - zone)) / zone, 0), 1);
  return down * down - up * up;
}

/** Whether they're there already, in one piece, so nothing needs asking for. */
export function isSamePlace(ids: readonly number[], moving: readonly number[], toIndex: number): boolean {
  const wanted = new Set(moving);
  const from = ids.findIndex((id) => wanted.has(id));
  return from === toIndex && ids.slice(from, from + moving.length).every((id) => wanted.has(id));
}
