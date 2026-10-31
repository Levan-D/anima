/** The order once `moving` start at `toIndex`, counted in what's left without them. They keep their relative order. */
export function moveIds(order: readonly number[], moving: readonly number[], toIndex: number): number[] {
  const wanted = new Set(moving);
  const moved = order.filter((id) => wanted.has(id));
  const rest = order.filter((id) => !wanted.has(id));
  const at = Math.min(toIndex, rest.length);
  return [...rest.slice(0, at), ...moved, ...rest.slice(at)];
}
