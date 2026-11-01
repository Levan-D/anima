import { ArtOverlays } from '@/app/ArtOverlays';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { WideLayout } from '@/app/WideLayout';
import { NowPlaying } from '@/features/NowPlaying/NowPlaying';
import { Radio } from '@/features/Radio/Radio';
import { Transport } from '@/features/Transport/Transport';

export function RadioPage() {
  return (
    <WideLayout transport={<Transport />}>
      <Radio
        art={
          <>
            <ErrorBoundary>
              <NowPlaying />
            </ErrorBoundary>
            <div className="pointer-events-none absolute inset-0 *:pointer-events-auto">
              <ErrorBoundary>
                <ArtOverlays />
              </ErrorBoundary>
            </div>
          </>
        }
      />
    </WideLayout>
  );
}
