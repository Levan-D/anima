import { ArtOverlays } from '@/app/ArtOverlays';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { TransportDock } from '@/app/TransportDock';
import { WideLayout } from '@/app/WideLayout';
import { ListMetricsProbe } from '@/components/music/ListMetricsProbe';
import { NowPlaying } from '@/features/NowPlaying/NowPlaying';
import { StationMarks } from '@/features/Radio/components/StationMarks';
import { TuneIt } from '@/features/Radio/components/TuneIt';
import { Radio } from '@/features/Radio/Radio';

export function RadioPage() {
  return (
    <WideLayout
      transport={
        <TransportDock
          action={
            <ErrorBoundary fallback={null}>
              <div className="flex shrink-0 items-center gap-1">
                <StationMarks />
                <TuneIt />
              </div>
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
