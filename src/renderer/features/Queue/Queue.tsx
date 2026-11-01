import type { ReactNode } from 'react';
import { ListSkeleton } from '@/components/music/ListSkeleton';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useQueue } from '@/features/Queue/hooks/useQueue';
import { QueueContents } from '@/features/Queue/QueueContents';
import { selectTab } from '@/lib/navigation';

const BROWSE = <Button onClick={() => selectTab('albums')}>Browse albums</Button>;

type Props = {
  /** The next step when nothing's queued, for a window that can't browse. */
  emptyAction?: ReactNode;
};

export function Queue({ emptyAction = BROWSE }: Props) {
  const queue = useQueue();

  if (queue.isPending) return <ListSkeleton kind="rows" />;
  if (queue.isError) return <ErrorState error={queue.error} onRetry={() => void queue.refetch()} />;
  if (queue.data.length === 0) {
    return (
      <EmptyState
        title="Nothing queued"
        description="Play a track and the list it's in lines up here"
        action={emptyAction}
      />
    );
  }
  return <QueueContents items={queue.data} />;
}
