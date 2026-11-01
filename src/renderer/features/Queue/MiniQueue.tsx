import { X } from 'lucide-react';
import { ListMetricsProbe } from '@/components/music/ListMetricsProbe';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { Text } from '@/components/ui/Text';
import { QueueActions, QueueSummary } from '@/features/Queue/components/QueueHeader';
import { Queue } from '@/features/Queue/Queue';
import { closeQueueSheet } from '@/lib/queueSheet';
import { setMiniPlayer } from '@/lib/windowActions';

const CLOSE_LABEL = 'Close queue';

/** The queue as the mini shows it, where a window has grown to hold it rather than a sheet coming up over anything. */
export function MiniQueue() {
  return (
    <section aria-label="Queue" data-testid="mini-queue" className="relative flex size-full flex-col bg-surface-raised">
      <ListMetricsProbe />
      <div className="flex shrink-0 items-center gap-1 py-1 pr-1 pl-gutter">
        <div className="flex min-w-0 flex-1 flex-col">
          <Text as="h2" variant="lead" truncate>
            Queue
          </Text>
          <QueueSummary />
        </div>
        <QueueActions />
        <Button
          variant="ghost"
          size="icon"
          aria-label={CLOSE_LABEL}
          title={CLOSE_LABEL}
          onClick={closeQueueSheet}
          className="shrink-0"
        >
          <X aria-hidden />
        </Button>
      </div>
      <Divider />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <Queue emptyAction={<Button onClick={() => setMiniPlayer(false)}>Back to the main window</Button>} />
      </div>
    </section>
  );
}
