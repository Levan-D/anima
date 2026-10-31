import { Equalizer } from '@/features/Equalizer/Equalizer';
import { Lyrics } from '@/features/Lyrics/Lyrics';
import { useArtOverlay } from '@/lib/artOverlay';

export function ArtOverlays() {
  const overlay = useArtOverlay((state) => state.overlay);
  if (overlay === 'eq') return <Equalizer />;
  return overlay === 'lyrics' ? <Lyrics /> : null;
}
