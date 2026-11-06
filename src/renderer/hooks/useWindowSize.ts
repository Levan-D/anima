import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  addEventListener('resize', onChange);
  return () => removeEventListener('resize', onChange);
}

// One string, so the snapshot only changes when the size does.
const size = () => `${innerWidth}×${innerHeight}`;

/** The window's size in CSS pixels, as the media queries see it. */
export function useWindowSize(): string {
  return useSyncExternalStore(subscribe, size);
}
