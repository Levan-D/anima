import { useQuery } from '@tanstack/react-query';
import { ListChecks } from 'lucide-react';
import { useRef, useState, type PointerEvent, type ReactElement, type SyntheticEvent } from 'react';
import type { PlaylistSummary } from '@shared/domain';
import type { MusicItem, TrackItem } from '@/components/music/listItems';
import { ContextMenu } from '@/components/ui/ContextMenu';
import type { MenuEntry } from '@/components/ui/menuEntries';
import { playlistsQuery } from '@/lib/playlistQueries';
import { queryClient } from '@/lib/queryClient';
import { selectedKeys, startSelecting, useSelection } from '@/lib/selection';

const NO_PLAYLISTS: PlaylistSummary[] = [];

type OpenMenu = {
  isOpen: boolean;
  item: TrackItem | null;
  /** The rows it acts on when there's more than the one pressed. */
  group: readonly TrackItem[] | null;
  isFromFinger: boolean;
};

type Props = {
  items: readonly MusicItem[];
  entriesFor: (item: TrackItem, playlists: readonly PlaylistSummary[]) => MenuEntry[];
  groupEntriesFor: (group: readonly TrackItem[], playlists: readonly PlaylistSummary[]) => MenuEntry[];
  /** The list. It's one element around the whole of it, and the row comes from where the press landed. */
  children: ReactElement;
};

function selectedItems(items: readonly MusicItem[], pressed: TrackItem): readonly TrackItem[] | null {
  const keys = selectedKeys();
  if (keys.size < 2 || !keys.has(pressed.key)) return null;
  return items.filter((item): item is TrackItem => item.kind === 'track' && keys.has(item.key));
}

/**
 * One menu for a whole list, so a row costs nothing for having one. Radix opens it on a right-click, the menu key or a
 * long press, and whatever isn't a track row just doesn't get one.
 */
export function TrackMenu({ items, entriesFor, groupEntriesFor, children }: Props) {
  const [menu, setMenu] = useState<OpenMenu>({ isOpen: false, item: null, group: null, isFromFinger: false });
  const target = useRef<TrackItem | null>(null);
  const isFinger = useRef(false);
  const isSelecting = useSelection((state) => state.isSelecting);
  const { data: playlists = NO_PLAYLISTS } = useQuery({ ...playlistsQuery, enabled: menu.isOpen }, queryClient);

  function noteTarget(event: SyntheticEvent): void {
    const index = (event.target as Element).closest('[data-index]')?.getAttribute('data-index');
    const item = index === null || index === undefined ? undefined : items[Number(index)];
    target.current = item?.kind === 'track' ? item : null;
  }

  function onPointerDownCapture(event: PointerEvent): void {
    noteTarget(event);
    isFinger.current = event.pointerType !== 'mouse';
  }

  function onContextMenuCapture(event: SyntheticEvent): void {
    noteTarget(event);
    // The menu key has no pointer, and a long press has already said what it was.
    if ((event.nativeEvent as globalThis.PointerEvent).pointerType === 'mouse') isFinger.current = false;
  }

  function onOpenChange(isOpen: boolean): void {
    if (!isOpen) setMenu((current) => ({ ...current, isOpen: false }));
    else if (target.current !== null) {
      setMenu({
        isOpen: true,
        item: target.current,
        group: selectedItems(items, target.current),
        isFromFinger: isFinger.current,
      });
    }
  }

  function entries(): MenuEntry[] {
    const { item, group, isFromFinger } = menu;
    if (item === null) return [];
    const forRows = group === null ? entriesFor(item, playlists) : groupEntriesFor(group, playlists);
    if (!isFromFinger || isSelecting || forRows.length === 0) return forRows;
    const select: MenuEntry = {
      kind: 'item',
      label: 'Select',
      icon: ListChecks,
      onSelect: () => startSelecting(item.key),
    };
    return [select, { kind: 'separator' }, ...forRows];
  }

  return (
    <ContextMenu
      entries={entries()}
      open={menu.isOpen}
      onOpenChange={onOpenChange}
      onContextMenuCapture={onContextMenuCapture}
      onPointerDownCapture={onPointerDownCapture}
    >
      {children}
    </ContextMenu>
  );
}
