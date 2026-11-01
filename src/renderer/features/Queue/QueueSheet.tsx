import { Infinity as InfinityIcon, ListX } from 'lucide-react';
import { useMemo } from 'react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { IconToggle } from '@/components/ui/IconToggle';
import { Text } from '@/components/ui/Text';
import { Tooltip } from '@/components/ui/Tooltip';
import { useQueue } from '@/features/Queue/hooks/useQueue';
import { Queue } from '@/features/Queue/Queue';
import { formatPlural, formatSpan, joinParts } from '@/lib/format';
import { backToQueue, clearQueue, setEndless } from '@/lib/playerActions';
import { usePlayer } from '@/lib/playerStore';
import { closeQueueSheet, queueButton, setQueueSheetOpen, useQueueSheet } from '@/lib/queueSheet';
import { clearSelection } from '@/lib/selection';

function QueueSummary() {
  const items = useQueue().data;
  const isRadio = usePlayer((state) => state.radio.isSource);
  const totalMs = useMemo(() => items?.reduce((total, { track }) => total + track.durationMs, 0) ?? 0, [items]);

  const amount = items === undefined ? '' : joinParts(formatPlural(items.length, 'track'), formatSpan(totalMs));
  return (
    <Text as="p" variant="meta" color="muted" tabular truncate>
      {isRadio ? joinParts(amount, "Radio is picking what's next") : amount}
    </Text>
  );
}

function QueueActions() {
  const isEndless = usePlayer((state) => state.endless);
  const isRadio = usePlayer((state) => state.radio.isSource);
  const hasSavedQueue = usePlayer((state) => state.radio.hasSavedQueue);
  const isEmpty = usePlayer((state) => state.queueLength === 0);

  return (
    <>
      {isRadio && hasSavedQueue ? (
        <Button variant="quiet" size="compact" onClick={backToQueue} className="shrink-0">
          Your saved queue
        </Button>
      ) : null}
      {isRadio ? null : (
        <IconToggle
          labelOff="Endless: off, stops at the end"
          labelOn="Endless: on, keeps finding more"
          isOn={isEndless}
          onPressedChange={setEndless}
          icon={InfinityIcon}
          onEscape={closeQueueSheet}
          className="shrink-0"
        />
      )}
      <Tooltip label="Clear queue" onEscape={closeQueueSheet}>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Clear queue"
          disabled={isEmpty}
          onClick={clearQueue}
          className="shrink-0"
        >
          <ListX aria-hidden />
        </Button>
      </Tooltip>
    </>
  );
}

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
