import { Infinity as InfinityIcon, ListX } from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '@/components/ui/Button';
import { IconToggle } from '@/components/ui/IconToggle';
import { Text } from '@/components/ui/Text';
import { Tooltip } from '@/components/ui/Tooltip';
import { useQueue } from '@/features/Queue/hooks/useQueue';
import { formatPlural, formatSpan, joinParts } from '@/lib/format';
import { backToQueue, clearQueue, setEndless } from '@/lib/playerActions';
import { usePlayer } from '@/lib/playerStore';
import { closeQueueSheet } from '@/lib/queueSheet';

export function QueueSummary() {
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

export function QueueActions() {
  const isEndless = usePlayer((state) => state.endless);
  const isRadio = usePlayer((state) => state.radio.isSource);
  const hasSavedQueue = usePlayer((state) => state.radio.hasSavedQueue);
  const isEmpty = usePlayer((state) => state.queueLength === 0);

  return (
    <>
      {isRadio && hasSavedQueue ? (
        <Tooltip label="Stops radio and goes back to your queue, paused where you left it" onEscape={closeQueueSheet}>
          <Button variant="quiet" size="compact" onClick={backToQueue} className="shrink-0">
            Your saved queue
          </Button>
        </Tooltip>
      ) : null}
      {isRadio ? null : (
        <IconToggle
          labelOff="Endless off: stops at the end of the queue. Press to keep adding similar tracks"
          labelOn="Endless on: adds similar tracks from your library as the queue runs out. Press to stop at the end"
          isOn={isEndless}
          onPressedChange={setEndless}
          icon={InfinityIcon}
          onEscape={closeQueueSheet}
          className="shrink-0"
        />
      )}
      <Tooltip
        label={isRadio && hasSavedQueue ? "Clears radio's list and goes back to your queue" : 'Clear queue'}
        onEscape={closeQueueSheet}
      >
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
