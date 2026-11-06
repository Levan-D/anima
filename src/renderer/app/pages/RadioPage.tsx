import { ArtOverlays } from '@/app/ArtOverlays';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { TransportDock } from '@/app/TransportDock';
import { WideLayout } from '@/app/WideLayout';
import { ListMetricsProbe } from '@/components/music/ListMetricsProbe';
import { NowPlaying } from '@/features/NowPlaying/NowPlaying';
import { TuneIt } from '@/features/Radio/components/TuneIt';
import { Radio } from '@/features/Radio/Radio';

export function RadioPage() {
  return (
    <WideLayout
      transport={
        <TransportDock
          action={
            <ErrorBoundary fallback={null}>
              <TuneIt />
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
            <ArtOverlays />
          </>
        }
      />
    </WideLayout>
  );
}
