import { useRef, useState, type ReactElement, type SyntheticEvent } from 'react';
import type { MusicItem, TrackItem } from '@/components/music/listItems';
import { ContextMenu } from '@/components/ui/ContextMenu';
import type { MenuEntry } from '@/components/ui/menuEntries';

type Props = {
  items: readonly MusicItem[];
  entriesFor: (item: TrackItem) => MenuEntry[];
  /** The list. It's one element around the whole of it, and the row comes from where the press landed. */
  children: ReactElement;
};

/**
 * One menu for a whole list, so a row costs nothing for having one. Radix opens it on a right-click, the menu key or a
 * long press, and whatever isn't a track row just doesn't get one.
 */
export function TrackMenu({ items, entriesFor, children }: Props) {
  const [menu, setMenu] = useState<{ isOpen: boolean; entries: MenuEntry[] }>({ isOpen: false, entries: [] });
  const target = useRef<TrackItem | null>(null);

  function noteTarget(event: SyntheticEvent): void {
    const index = (event.target as Element).closest('[data-index]')?.getAttribute('data-index');
    const item = index === null || index === undefined ? undefined : items[Number(index)];
    target.current = item?.kind === 'track' ? item : null;
  }

  function onOpenChange(isOpen: boolean): void {
    if (!isOpen) setMenu((current) => ({ ...current, isOpen: false }));
    else if (target.current !== null) setMenu({ isOpen: true, entries: entriesFor(target.current) });
  }

  return (
    <ContextMenu
      entries={menu.entries}
      open={menu.isOpen}
      onOpenChange={onOpenChange}
      onContextMenuCapture={noteTarget}
      onPointerDownCapture={noteTarget}
    >
      {children}
    </ContextMenu>
  );
}
