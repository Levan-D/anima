const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function hashOf(text: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), FNV_PRIME) >>> 0;
  return hash;
}

/** A new order for each seed, and the same one for as long as the seed is kept, however often it's asked for. */
export function shuffledBy<T>(items: readonly T[], keyOf: (item: T) => string, seed: number): T[] {
  return items
    .map((item) => ({ item, rank: hashOf(`${seed}:${keyOf(item)}`) }))
    .toSorted((a, b) => a.rank - b.rank)
    .map(({ item }) => item);
}
