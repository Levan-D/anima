/* The genres that are on and the search text. Out here because a page unmounts while it's away, and should come back as it was. */
import { create } from 'zustand';
import { mainGenreOf } from './utils/suggestions';

const useFilterStore = create<{ mains: readonly string[]; subs: readonly string[]; query: string }>()(() => ({
  mains: [],
  subs: [],
  query: '',
}));

export function useMainGenres(): readonly string[] {
  return useFilterStore((state) => state.mains);
}

export function useSubGenres(): readonly string[] {
  return useFilterStore((state) => state.subs);
}

export function useDiscoverQuery(): string {
  return useFilterStore((state) => state.query);
}

export function setDiscoverQuery(query: string): void {
  useFilterStore.setState({ query });
}

/** A sub genre goes when its main genre does. */
export function setMainGenres(mains: readonly string[]): void {
  useFilterStore.setState(({ subs }) => ({ mains, subs: subs.filter((sub) => mains.includes(mainGenreOf(sub))) }));
}

export function setSubGenres(subs: readonly string[]): void {
  useFilterStore.setState({ subs });
}

export function clearSelectedGenres(): void {
  useFilterStore.setState({ mains: [], subs: [] });
}
