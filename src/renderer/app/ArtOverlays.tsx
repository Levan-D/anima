import { Lyrics } from '@/features/Lyrics/Lyrics';
import { useArtOverlay } from '@/lib/artOverlay';

export function ArtOverlays() {
  const overlay = useArtOverlay((state) => state.overlay);
  return overlay === 'lyrics' ? <Lyrics /> : null;
}
