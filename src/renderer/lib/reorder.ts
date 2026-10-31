/* What a drag over a list means, in numbers. A gap is a place between rows: gap 0 is above the first, gap n below row n-1. */

export type RowBox = {
  /** Its place among the rows that can be reordered. */
  index: number;
  top: number;
  height: number;
};

/** The gap nearest `y`. Only the rows on screen are known, which always includes the ones near a pointer inside the list. */
export function gapAt(rows: readonly RowBox[], y: number): number | null {
  const last = rows.at(-1);
  if (last === undefined) return null;
  const under = rows.find(({ top, height }) => y < top + height / 2);
  return under?.index ?? last.index + 1;
}

/** Where the moved ids start once they land in that gap, counted in the list without them: what a move command takes. */
export function gapToIndex(ids: readonly number[], moving: readonly number[], gap: number): number {
  const wanted = new Set(moving);
  return ids.slice(0, gap).filter((id) => !wanted.has(id)).length;
}

/** Whether they're there already, in one piece, so nothing needs asking for. */
export function isSamePlace(ids: readonly number[], moving: readonly number[], toIndex: number): boolean {
  const wanted = new Set(moving);
  const from = ids.findIndex((id) => wanted.has(id));
  return from === toIndex && ids.slice(from, from + moving.length).every((id) => wanted.has(id));
}
