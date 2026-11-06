import { useQuery } from '@tanstack/react-query';
import { ListSkeleton } from '@/components/music/ListSkeleton';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { discoverQuery } from '@/lib/libraryQueries';
import { openSettings } from '@/lib/pages';
import { DiscoverContents } from './DiscoverContents';

export function Discover() {
  const discover = useQuery(discoverQuery);

  if (discover.isPending) return <ListSkeleton kind="rows" />;
  if (discover.isError) return <ErrorState error={discover.error} onRetry={() => void discover.refetch()} />;
  if (discover.data.artists.length === 0) {
    return (
      <EmptyState
        title={discover.data.hasData ? 'Nothing new to suggest' : 'No listener data yet'}
        description={
          discover.data.hasData
            ? 'Everything listeners of your artists point at is already here'
            : 'Update Discover data in Settings, under Online and data'
        }
        action={<Button onClick={() => openSettings('data')}>Open settings</Button>}
      />
    );
  }
  return <DiscoverContents list={discover.data} />;
}
