import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ListSkeleton } from '@/components/music/ListSkeleton';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { QueueContents } from '@/features/Queue/QueueContents';
import { selectTab } from '@/lib/navigation';
import { queueQuery } from '@/lib/playerQueries';
import { usePlayer } from '@/lib/playerStore';

/** What's coming up. Main holds it, and says when it has changed by moving on to a new version. */
export function Queue() {
  const version = usePlayer((state) => state.queueVersion);
  const queue = useQuery({ ...queueQuery(version), placeholderData: keepPreviousData });

  if (queue.isPending) return <ListSkeleton kind="rows" />;
  if (queue.isError) return <ErrorState error={queue.error} onRetry={() => void queue.refetch()} />;
  if (queue.data.length === 0) {
    return (
      <EmptyState
        title="Nothing queued"
        description="Play a track and the list it's in lines up here"
        action={<Button onClick={() => selectTab('albums')}>Browse albums</Button>}
      />
    );
  }
  return <QueueContents items={queue.data} />;
}
