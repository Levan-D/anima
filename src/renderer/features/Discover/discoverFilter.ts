/* The genres that are on. Out here because a page unmounts while it's away, and should come back as it was. */
import { create } from 'zustand';

const useFilterStore = create<{ genres: readonly string[] }>()(() => ({ genres: [] }));

export function useSelectedGenres(): readonly string[] {
  return useFilterStore((state) => state.genres);
}

export function setSelectedGenres(genres: readonly string[]): void {
  useFilterStore.setState({ genres });
}

export function clearSelectedGenres(): void {
  useFilterStore.setState({ genres: [] });
}
