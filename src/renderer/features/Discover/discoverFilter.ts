/* The genres that are on and the search text. Out here because a page unmounts while it's away, and should come back as it was. */
import { create } from 'zustand';

const useFilterStore = create<{ genres: readonly string[]; query: string }>()(() => ({ genres: [], query: '' }));

export function useSelectedGenres(): readonly string[] {
  return useFilterStore((state) => state.genres);
}

export function useDiscoverQuery(): string {
  return useFilterStore((state) => state.query);
}

export function setDiscoverQuery(query: string): void {
  useFilterStore.setState({ query });
}

export function setSelectedGenres(genres: readonly string[]): void {
  useFilterStore.setState({ genres });
}

export function clearSelectedGenres(): void {
  useFilterStore.setState({ genres: [] });
}
