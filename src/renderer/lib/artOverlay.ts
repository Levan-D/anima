/* What's open over the album art. Hotkeys and the Back keys both reach it, and neither imports the views it opens. */
import { create } from 'zustand';

export type ArtOverlay = 'lyrics' | 'eq';

type ArtOverlayState = {
  overlay: ArtOverlay | null;
};

const useArtOverlayStore = create<ArtOverlayState>()(() => ({ overlay: null }));

export function useArtOverlay<T>(selector: (state: ArtOverlayState) => T): T {
  return useArtOverlayStore(selector);
}

export function toggleArtOverlay(overlay: ArtOverlay): void {
  useArtOverlayStore.setState((state) => ({ overlay: state.overlay === overlay ? null : overlay }));
}

/** Says whether there was one to close, because going back closes this before anything else. */
export function closeArtOverlay(): boolean {
  if (useArtOverlayStore.getState().overlay === null) return false;
  useArtOverlayStore.setState({ overlay: null });
  return true;
}
