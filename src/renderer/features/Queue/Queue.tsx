import { ListSkeleton } from '@/components/music/ListSkeleton';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useQueue } from '@/features/Queue/hooks/useQueue';
import { QueueContents } from '@/features/Queue/QueueContents';
import { selectTab } from '@/lib/navigation';

export function Queue() {
  const queue = useQueue();

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
