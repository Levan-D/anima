import { BottomSheet } from '@/components/ui/BottomSheet';
import { QueueActions, QueueSummary } from '@/features/Queue/components/QueueHeader';
import { Queue } from '@/features/Queue/Queue';
import { queueButton, setQueueSheetOpen, useQueueSheet } from '@/lib/queueSheet';
import { clearSelection } from '@/lib/selection';

function clearSelectionFirst(event: KeyboardEvent): void {
  if (clearSelection()) event.preventDefault();
}

// Over the transport's title and seekbar, with its two rows of buttons left clear, so the Queue button can still close it.
const SITS_OVER_THE_TRACK =
  '[--clear:calc(var(--spacing-tap)*2+var(--spacing-transport-end))] bottom-(--clear) mb-0 h-[calc(60vh+var(--spacing-gap)+var(--spacing-transport)-var(--clear))] max-h-[calc(100vh-var(--spacing-page-bar)-var(--clear)-var(--spacing-gap)*2)]';

export function QueueSheet() {
  const isOpen = useQueueSheet();

  return (
    <BottomSheet
      open={isOpen}
      onOpenChange={setQueueSheetOpen}
      title="Queue"
      subtitle={<QueueSummary />}
      actions={<QueueActions />}
      closeLabel="Close queue"
      originOf={queueButton}
      onEscapeKeyDown={clearSelectionFirst}
      className={SITS_OVER_THE_TRACK}
    >
      {(hasRisen) => <Queue canMountRows={hasRisen} />}
    </BottomSheet>
  );
}
