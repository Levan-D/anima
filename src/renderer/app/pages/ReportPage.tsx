import { TransportDock } from '@/app/TransportDock';
import { WideLayout } from '@/app/WideLayout';
import { ListMetricsProbe } from '@/components/music/ListMetricsProbe';
import { LibraryReport } from '@/features/LibraryReport/LibraryReport';

export function ReportPage() {
  return (
    <WideLayout transport={<TransportDock />}>
      <ListMetricsProbe />
      <LibraryReport />
    </WideLayout>
  );
}
