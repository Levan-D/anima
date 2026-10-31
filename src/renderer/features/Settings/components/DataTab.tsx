import { useQuery } from '@tanstack/react-query';
import type { DatasetId } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { UpdateRow } from '@/features/Settings/components/UpdateRow';
import { cancelDataset, refreshListenerData, updateEverything } from '@/lib/dataActions';
import { dataStateQuery } from '@/lib/libraryQueries';

const WORDS: Record<DatasetId, { title: string; doneWords: string; missingWords: string }> = {
  library: { title: 'Library', doneWords: 'tracks', missingWords: 'missing from disk' },
  lyrics: { title: 'Lyrics', doneWords: 'looked up', missingWords: 'not yet' },
  fingerprints: { title: 'Fingerprints', doneWords: 'analyzed', missingWords: 'not yet' },
  listeners: { title: 'Listener data', doneWords: 'looked up', missingWords: 'not yet' },
};

export function DataTab() {
  const data = useQuery(dataStateQuery);

  if (data.isPending) {
    return (
      <div aria-hidden className="flex flex-col gap-section pt-section">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (data.isError) return <ErrorState error={data.error} onRetry={() => void data.refetch()} />;

  const { datasets, isRunningAll } = data.data;
  const isRefreshing = datasets.some(({ id, progress }) => id === 'listeners' && progress !== null);

  return (
    <section aria-label="Data" className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-gap gap-y-2 py-section">
        <Text as="p" variant="meta" color="muted" className="min-w-0 flex-[1_1_20em]">
          Only runs when you ask. Fingerprints take about 2 hours the first time, and listener data about 2 hours
        </Text>
        {isRunningAll ? (
          <Button variant="outline" size="md" onClick={() => cancelDataset(null)}>
            Stop everything
          </Button>
        ) : (
          <Button variant="primary" size="md" onClick={updateEverything}>
            Update everything
          </Button>
        )}
      </div>
      {datasets.map((dataset) => (
        <UpdateRow key={dataset.id} dataset={dataset} {...WORDS[dataset.id]} />
      ))}
      <div className="flex flex-wrap items-center justify-between gap-x-gap gap-y-2 border-t border-divider py-section">
        <Text as="p" variant="meta" color="muted" className="min-w-0 flex-[1_1_20em]">
          Asks again about everything in listener data
        </Text>
        <Button variant="ghost" size="md" disabled={isRefreshing} onClick={refreshListenerData}>
          Refresh all
        </Button>
      </div>
    </section>
  );
}
