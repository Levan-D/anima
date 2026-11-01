import { TransportDock } from '@/app/TransportDock';
import { WideLayout } from '@/app/WideLayout';
import { ListMetricsProbe } from '@/components/music/ListMetricsProbe';
import { Discover } from '@/features/Discover/Discover';

export function DiscoverPage() {
  return (
    <WideLayout transport={<TransportDock />}>
      <ListMetricsProbe />
      <Discover />
    </WideLayout>
  );
}
