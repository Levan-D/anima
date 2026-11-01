import { ArrowDown, ArrowUp, ListX, Play } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { PlaylistSummary, QueueItem } from '@shared/domain';
import { addToPlaylistEntry } from '@/components/music/addToPlaylistEntry';
import type { MusicSection, TrackItem } from '@/components/music/listItems';
import { MusicList } from '@/components/music/MusicList';
import { trackFileEntries } from '@/components/music/trackMenuEntries';
import { Button } from '@/components/ui/Button';
import type { MenuEntry } from '@/components/ui/menuEntries';
import { Text } from '@/components/ui/Text';
import { formatPlural, formatSpan, joinParts } from '@/lib/format';
import { forgetList, rememberScroll } from '@/lib/listMemory';
import { useListMetrics } from '@/lib/listMetrics';
import { placeKey } from '@/lib/navigation';
import { clearQueue, moveInQueue, playQueueIndex, removeFromQueue } from '@/lib/playerActions';
import { playerState } from '@/lib/playerStore';

const QUEUE_LIST = placeKey({ kind: 'queue' });
const ROWS_ABOVE_CURRENT = 2;

function playRow(_track: unknown, queueIndex: number | null): void {
  if (queueIndex !== null) playQueueIndex(queueIndex);
}

/** The queue's own: playing one of them can't replace the queue they're in, and queueing them again would double them. */
function selectionMenuFor(group: readonly TrackItem[], playlists: readonly PlaylistSummary[]): MenuEntry[] {
  const firstPlayable = group.find(({ track }) => !track.isMissing)?.queueIndex ?? null;
  return [
    { kind: 'label', label: formatPlural(group.length, 'track') },
    {
      kind: 'item',
      label: 'Play',
      icon: Play,
      disabled: firstPlayable === null,
      onSelect: () => {
        if (firstPlayable !== null) playQueueIndex(firstPlayable);
      },
    },
    { kind: 'separator' },
    addToPlaylistEntry(
      group.map(({ track }) => track.id),
      playlists,
    ),
    { kind: 'separator' },
    {
      kind: 'item',
      label: 'Remove from queue',
      icon: ListX,
      onSelect: () => removeFromQueue(group.flatMap(({ dragId }) => dragId ?? [])),
    },
  ];
}

type Props = {
  items: QueueItem[];
};

export function QueueContents({ items }: Props) {
  const { row } = useListMetrics();

  // Coming to the queue is coming to see what's next, wherever it was last scrolled to. Before the list mounts, because
  // that's when it reads this.
  useState(() => {
    const { queueIndex } = playerState();
    forgetList(QUEUE_LIST);
    if (queueIndex !== null) rememberScroll(QUEUE_LIST, Math.max(queueIndex - ROWS_ABOVE_CURRENT, 0) * row);
  });

  const sections = useMemo((): MusicSection[] => [{ kind: 'queue', items }], [items]);
  const totalMs = useMemo(() => items.reduce((total, { track }) => total + track.durationMs, 0), [items]);

  function menuFor({ track, queueIndex }: TrackItem, playlists: readonly PlaylistSummary[]): MenuEntry[] {
    const index = queueIndex ?? 0;
    const queueId = items[index]?.queueId;
    if (queueId === undefined) return [];
    return [
      { kind: 'item', label: 'Play', icon: Play, disabled: track.isMissing, onSelect: () => playQueueIndex(index) },
      {
        kind: 'item',
        label: 'Move up',
        icon: ArrowUp,
        disabled: index === 0,
        onSelect: () => moveInQueue([queueId], index - 1),
      },
      {
        kind: 'item',
        label: 'Move down',
        icon: ArrowDown,
        disabled: index === items.length - 1,
        onSelect: () => moveInQueue([queueId], index + 1),
      },
      { kind: 'separator' },
      ...trackFileEntries(track, playlists),
      { kind: 'separator' },
      { kind: 'item', label: 'Remove from queue', icon: ListX, onSelect: () => removeFromQueue([queueId]) },
    ];
  }

  return (
    <MusicList
      label="Queue"
      sections={sections}
      memoryKey={QUEUE_LIST}
      onPlayTrack={playRow}
      menuFor={menuFor}
      selectionMenuFor={selectionMenuFor}
      onReorder={moveInQueue}
      header={
        <div className="flex items-center justify-between gap-gap pr-1 pl-gutter">
          <Text as="p" variant="meta" color="muted" tabular truncate>
            {joinParts(formatPlural(items.length, 'track'), formatSpan(totalMs))}
          </Text>
          <Button variant="ghost" size="compact" onClick={clearQueue}>
            Clear
          </Button>
        </div>
      }
    />
  );
}
