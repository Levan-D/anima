import { ArtOverlays } from '@/app/ArtOverlays';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { TransportDock } from '@/app/TransportDock';
import { WideLayout } from '@/app/WideLayout';
import { ListMetricsProbe } from '@/components/music/ListMetricsProbe';
import { NowPlaying } from '@/features/NowPlaying/NowPlaying';
import { TuneInDrawer } from '@/features/Radio/components/TuneInDrawer';
import { Radio } from '@/features/Radio/Radio';

export function RadioPage() {
  return (
    <WideLayout
      transport={
        <TransportDock
          action={
            <ErrorBoundary fallback={null}>
              <TuneInDrawer />
            </ErrorBoundary>
          }
        />
      }
    >
      <ListMetricsProbe />
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
