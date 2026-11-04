import { useMemo, useState } from 'react';
import { shuffledBy } from '../utils/shuffledBy';

/** A few of these at random, drawn again each time what uses it opens, and kept while it stays open. */
export function useSuggested<T extends { id: number }>(items: readonly T[] | undefined, count: number): T[] {
  const [seed] = useState(Math.random);
  return useMemo(() => shuffledBy(items ?? [], ({ id }) => String(id), seed).slice(0, count), [items, seed, count]);
}
