import { ArrowDown, ArrowUp, ListX, Play } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { PlaylistSummary, QueueItem } from '@shared/domain';
import { addToPlaylistEntry } from '@/components/music/addToPlaylistEntry';
import type { MusicSection, TrackItem } from '@/components/music/listItems';
import { MusicList } from '@/components/music/MusicList';
import { trackFileEntries } from '@/components/music/trackMenuEntries';
import type { MenuEntry } from '@/components/ui/menuEntries';
import { formatPlural } from '@/lib/format';
import { announceArrival, forgetList, rememberFocus, rememberScroll } from '@/lib/listMemory';
import { useListMetrics } from '@/lib/listMetrics';
import { moveInQueue, playQueueItem, removeFromQueue } from '@/lib/playerActions';
import { playerState } from '@/lib/playerStore';

const QUEUE_LIST = 'queue';
const ROWS_ABOVE_CURRENT = 2;

function removeRow(queueId: number): void {
  removeFromQueue([queueId]);
}

/** The queue's own: playing one of them can't replace the queue they're in, and queueing them again would double them. */
function selectionMenuFor(group: readonly TrackItem[], playlists: readonly PlaylistSummary[]): MenuEntry[] {
  const firstPlayable = group.find(({ track }) => !track.isMissing)?.dragId ?? null;
  return [
    { kind: 'label', label: formatPlural(group.length, 'track') },
    {
      kind: 'item',
      label: 'Play',
      icon: Play,
      disabled: firstPlayable === null,
      onSelect: () => {
        if (firstPlayable !== null) playQueueItem(firstPlayable);
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

  // Coming to the queue is coming to see what's next, wherever it was last scrolled to, with the keyboard on the current
  // row. Before the list mounts, because that's when it reads this.
  useState(() => {
    const { queueIndex } = playerState();
    forgetList(QUEUE_LIST);
    if (queueIndex === null) return;
    rememberScroll(QUEUE_LIST, Math.max(queueIndex - ROWS_ABOVE_CURRENT, 0) * row);
    rememberFocus(QUEUE_LIST, { index: queueIndex, column: 0 });
    announceArrival('went-back');
  });

  const sections = useMemo((): MusicSection[] => [{ kind: 'queue', items }], [items]);

  function playRow(_track: unknown, queueIndex: number | null): void {
    const queueId = queueIndex === null ? undefined : items[queueIndex]?.queueId;
    if (queueId !== undefined) playQueueItem(queueId);
  }

  function menuFor({ track, queueIndex }: TrackItem, playlists: readonly PlaylistSummary[]): MenuEntry[] {
    const index = queueIndex ?? 0;
    const queueId = items[index]?.queueId;
    if (queueId === undefined) return [];
    return [
      { kind: 'item', label: 'Play', icon: Play, disabled: track.isMissing, onSelect: () => playQueueItem(queueId) },
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
      onRemoveRow={removeRow}
      removeRowLabel="Remove from queue"
    />
  );
}
