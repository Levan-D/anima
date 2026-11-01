import { useQuery } from '@tanstack/react-query';
import { ListSkeleton } from '@/components/music/ListSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { reportQuery } from '@/lib/libraryQueries';
import { useReportCheck } from '@/lib/pages';
import { CheckDetail } from './components/CheckDetail';
import { ReportContents } from './ReportContents';

/** A to-do for fixing by hand in foobar2000. Nothing on this page changes a file. */
export function LibraryReport() {
  const report = useQuery(reportQuery);
  const openCheck = useReportCheck();

  if (report.isPending) return <ListSkeleton kind="rows" />;
  if (report.isError) return <ErrorState error={report.error} onRetry={() => void report.refetch()} />;
  if (report.data.summary.tracks === 0) {
    return <EmptyState title="Nothing to report yet" description="This fills in once the library has been scanned" />;
  }

  const check = report.data.groups.flatMap(({ checks }) => checks).find(({ id }) => id === openCheck);
  if (check) return <CheckDetail check={check} />;
  return <ReportContents report={report.data} />;
}
