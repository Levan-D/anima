import { ErrorBoundary } from '@/app/ErrorBoundary';
import { Fade } from '@/components/ui/Fade';
import { Lyrics } from '@/features/Lyrics/Lyrics';
import { useArtOverlay } from '@/lib/artOverlay';

/** Over the art, and only as big as it. Only what's showing takes the pointer, so the art's own buttons still work. */
export function ArtOverlays() {
  const overlay = useArtOverlay((state) => state.overlay);
  return (
    <div className="pointer-events-none absolute inset-0 *:pointer-events-auto">
      <ErrorBoundary>
        <Fade show={overlay === 'lyrics'} className="size-full">
          <Lyrics />
        </Fade>
      </ErrorBoundary>
    </div>
  );
}
