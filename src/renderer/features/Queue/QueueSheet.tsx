import { BottomSheet } from '@/components/ui/BottomSheet';
import { QueueActions, QueueSummary } from '@/features/Queue/components/QueueHeader';
import { Queue } from '@/features/Queue/Queue';
import { queueButton, setQueueSheetOpen, useQueueSheet } from '@/lib/queueSheet';
import { clearSelection } from '@/lib/selection';

function clearSelectionFirst(event: KeyboardEvent): void {
  if (clearSelection()) event.preventDefault();
}

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
    >
      <Queue />
    </BottomSheet>
  );
}
