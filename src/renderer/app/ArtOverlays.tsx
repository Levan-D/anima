import { Fade } from '@/components/ui/Fade';
import { Lyrics } from '@/features/Lyrics/Lyrics';
import { useArtOverlay } from '@/lib/artOverlay';

export function ArtOverlays() {
  const overlay = useArtOverlay((state) => state.overlay);
  return (
    <Fade show={overlay === 'lyrics'} className="size-full">
      <Lyrics />
    </Fade>
  );
}
