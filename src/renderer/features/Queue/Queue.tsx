import { ListSkeleton } from '@/components/music/ListSkeleton';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useQueue } from '@/features/Queue/hooks/useQueue';
import { QueueContents } from '@/features/Queue/QueueContents';
import { selectTab } from '@/lib/navigation';

const BROWSE = <Button onClick={() => selectTab('albums')}>Browse albums</Button>;

type Props = {
  /** False while what it's in is still moving. */
  canMountRows: boolean;
};

export function Queue({ canMountRows }: Props) {
  const queue = useQueue();

  if (queue.isPending) return <ListSkeleton kind="rows" />;
  if (queue.isError) return <ErrorState error={queue.error} onRetry={() => void queue.refetch()} />;
  if (queue.data.length === 0) {
    return (
      <EmptyState
        title="Nothing queued"
        description="Play a track and the list it's in lines up here"
        action={BROWSE}
      />
    );
  }
  if (!canMountRows) return <ListSkeleton kind="rows" />;
  return (
    <div className="content-in flex min-h-0 flex-1 flex-col">
      <QueueContents items={queue.data} />
    </div>
  );
}
