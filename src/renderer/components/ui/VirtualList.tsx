import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { useCallback, useMemo, useRef, type ReactNode, type RefCallback } from 'react';
import { useElementSize } from '@/hooks/useElementSize';
import { useKeptScrollPosition } from '@/hooks/useKeptScrollPosition';
import { useListKeyboard } from '@/hooks/useListKeyboard';
import { cn } from '@/lib/cn';
import { recallList, rememberScroll, type ListCell } from '@/lib/listMemory';

const OVERSCAN_ITEMS = 6;

type Props<Item> = {
  label: string;
  items: readonly Item[];
  getKey: (item: Item) => string;
  /** In pixels. Whole numbers, so the rows' text stays on the pixel grid. */
  getSize: (item: Item) => number;
  /** How many things in the item take focus: 0 for a heading, more than 1 across a row of cards. */
  getColumns: (item: Item) => number;
  /** What one of those things is, which outlasts where it happens to be. */
  getCellKey: (item: Item, column: number) => string;
  renderItem: (item: Item) => ReactNode;
  /** Names this list's place: mounting with the same key puts the scroll position back. */
  memoryKey: string;
  /** What the sizes were worked out from, null until they're known. A new value keeps the same content in view. */
  layoutKey: string | null;
  /** A new value means it's a different list now, starting from the top, without remounting what's the same in both. */
  resetKey?: string;
  /** Scrolls with the list, and can be any height. */
  header?: ReactNode;
  /** Gets a zero-height element as wide as a row's content, so its width can be measured. */
  contentRef?: RefCallback<HTMLDivElement>;
  paddingStart?: number;
  paddingEnd?: number;
  /** How far from the edge a focused item stops, so what it draws around itself isn't clipped. */
  scrollPadding?: number;
  /** The same at the end, where something may float over the list. Defaults to `scrollPadding`. */
  scrollPaddingEnd?: number;
  /** Items kept mounted past each end. Fewer for items that are costly to mount. */
  overscan?: number;
  /** Arrow Up on the first row. */
  onLeaveTop?: () => void;
  /** A move of focus with Shift held. */
  onShiftMove?: (from: Item, to: Item) => void;
  className?: string;
};

export function VirtualList<Item>({
  label,
  items,
  getKey,
  getSize,
  getColumns,
  getCellKey,
  renderItem,
  memoryKey,
  layoutKey,
  resetKey,
  header,
  contentRef,
  paddingStart = 0,
  paddingEnd = 0,
  scrollPadding = 0,
  scrollPaddingEnd = scrollPadding,
  overscan = OVERSCAN_ITEMS,
  onLeaveTop,
  onShiftMove,
  className,
}: Props<Item>) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [headerRef, { height: headerHeight }] = useElementSize<HTMLDivElement>();
  const focusedRef = useRef<ListCell | null>(null);

  // The virtualizer keeps its sizes until this function changes, which is how it hears the layout did.
  const getItemKey = useMemo(() => {
    void layoutKey;
    return (index: number) => {
      const item = items[index];
      return item === undefined ? index : getKey(item);
    };
  }, [getKey, items, layoutKey]);

  const estimateSize = useCallback(
    (index: number) => {
      const item = items[index];
      return item === undefined ? 0 : getSize(item);
    },
    [getSize, items],
  );

  // A row that has focus stays in the DOM when it scrolls away, or the focus would fall back to the page.
  const rangeExtractor = useCallback((range: Range) => {
    const indexes = defaultRangeExtractor(range);
    const index = focusedRef.current?.index;
    const first = indexes[0];
    if (index === undefined || first === undefined || index >= range.count || indexes.includes(index)) return indexes;
    return index < first ? [index, ...indexes] : [...indexes, index];
  }, []);

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: items.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize,
    getItemKey,
    rangeExtractor,
    overscan,
    scrollMargin: headerHeight,
    paddingStart,
    paddingEnd,
    scrollPaddingStart: scrollPadding,
    scrollPaddingEnd,
    initialOffset: () => recallList(memoryKey).top,
  });

  const total = virtualizer.getTotalSize();
  useKeptScrollPosition(scrollerRef, memoryKey, layoutKey, total, resetKey ?? null);

  const columnsAt = useCallback(
    (index: number) => {
      const item = items[index];
      return item === undefined ? 0 : getColumns(item);
    },
    [getColumns, items],
  );
  const firstWithFocus = useMemo(() => items.findIndex((item) => getColumns(item) > 0), [getColumns, items]);
  const scrollToIndex = useCallback(
    (index: number) => {
      // Nothing above the first of them is worth leaving out: not the padding, a heading or the list's own header.
      if (index === firstWithFocus) virtualizer.scrollToOffset(0);
      else virtualizer.scrollToIndex(index, { align: 'auto' });
    },
    [firstWithFocus, virtualizer],
  );
  const firstVisibleIndex = useCallback(() => {
    const offset = virtualizer.scrollOffset ?? 0;
    const first = virtualizer.getVirtualItems().find(({ index, start }) => start >= offset && columnsAt(index) > 0);
    return first?.index ?? null;
  }, [columnsAt, virtualizer]);
  // A whole screen, less one so there's something to recognize after the jump. What's rendered says nothing about this.
  const pageSize = useCallback(
    (index: number) => {
      const item = items[index];
      const size = item === undefined ? 0 : getSize(item);
      if (size <= 0) return 1;
      return Math.max(Math.floor((scrollerRef.current?.clientHeight ?? 0) / size) - 1, 1);
    },
    [getSize, items],
  );
  const keyOfCell = useCallback(
    ({ index, column }: ListCell) => {
      const item = items[index];
      return item === undefined ? null : getCellKey(item, column);
    },
    [getCellKey, items],
  );
  const findCell = useCallback(
    (key: string): ListCell | null => {
      for (const [index, item] of items.entries()) {
        const columns = getColumns(item);
        for (let column = 0; column < columns; column++) {
          if (getCellKey(item, column) === key) return { index, column };
        }
      }
      return null;
    },
    [getCellKey, getColumns, items],
  );

  const onShiftMoveCell = useCallback(
    (from: ListCell, to: ListCell) => {
      const fromItem = items[from.index];
      const toItem = items[to.index];
      if (fromItem !== undefined && toItem !== undefined) onShiftMove?.(fromItem, toItem);
    },
    [items, onShiftMove],
  );

  const { onKeyDown, onFocus, onBlur } = useListKeyboard({
    listRef,
    focusedRef,
    memoryKey,
    resetKey: resetKey ?? null,
    count: items.length,
    columnsAt,
    firstVisibleIndex,
    pageSize,
    scrollToIndex,
    keyOfCell,
    findCell,
    onLeaveTop,
    onShiftMove: onShiftMoveCell,
  });

  return (
    <div
      ref={scrollerRef}
      // Chromium makes a scroller a tab stop when nothing in it can be tabbed to, which is the case while a row has focus.
      tabIndex={-1}
      data-testid="list-scroller"
      data-scroller
      onScroll={(event) => rememberScroll(memoryKey, event.currentTarget.scrollTop)}
      className={cn(
        '@container min-h-0 flex-1 scrollbar-stable overflow-y-auto outline-hidden contain-strict [overflow-anchor:none]',
        className,
      )}
    >
      {contentRef ? <div ref={contentRef} aria-hidden className="mx-gutter h-0" /> : null}
      {header ? <div ref={headerRef}>{header}</div> : null}
      <div
        ref={listRef}
        role="list"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        style={{ height: total }}
        className="relative w-full outline-hidden"
      >
        {virtualizer.getVirtualItems().map(({ key, index, start, size }) => {
          const item = items[index];
          if (item === undefined) return null;
          const top = start - headerHeight;
          return (
            <div
              key={key}
              role="listitem"
              data-index={index}
              style={{ top, height: size }}
              className="absolute inset-x-0"
            >
              {renderItem(item)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
