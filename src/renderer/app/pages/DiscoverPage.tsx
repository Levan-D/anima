import { WideLayout } from '@/app/WideLayout';
import { ListMetricsProbe } from '@/components/music/ListMetricsProbe';
import { Discover } from '@/features/Discover/Discover';
import { Transport } from '@/features/Transport/Transport';

export function DiscoverPage() {
  return (
    <WideLayout transport={<Transport />}>
      <ListMetricsProbe />
      <Discover />
    </WideLayout>
  );
}
