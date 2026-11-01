import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { useCallback, useMemo, useRef, type FocusEvent, type RefObject } from 'react';
import type { DiscoverDetail } from '@shared/domain';
import { AlbumArt } from '@/components/music/AlbumArt';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { Text } from '@/components/ui/Text';
import { useListMetrics } from '@/lib/listMetrics';
import { useTopWithin } from '../hooks/useTopWithin';
import { strengthWords } from '../utils/suggestions';

const OVERSCAN_ROWS = 6;

type Props = {
  voices: DiscoverDetail['voices'];
  /** What it scrolls with, along with whatever's above and below it. */
  scrollerRef: RefObject<HTMLDivElement | null>;
  onOpenArtist: (artistId: number) => void;
};

/** Not VirtualList: that's a scroller of its own, and this one shares the modal's with the rest of what's in it. */
export function VoiceList({ voices, scrollerRef, onOpenArtist }: Props) {
  const { row } = useListMetrics();
  const [listRef, top] = useTopWithin<HTMLUListElement>(scrollerRef);
  const focusedRef = useRef<number | null>(null);

  // The virtualizer keeps its sizes until this function changes, which is how it hears the row height did.
  const getItemKey = useMemo(() => {
    void row;
    return (index: number) => voices[index]?.artistId ?? index;
  }, [row, voices]);

  // A row that has focus stays in the DOM when it scrolls away, or the focus would fall back to the page.
  const rangeExtractor = useCallback((range: Range) => {
    const indexes = defaultRangeExtractor(range);
    const index = focusedRef.current;
    const first = indexes[0];
    if (index === null || first === undefined || index >= range.count || indexes.includes(index)) return indexes;
    return index < first ? [index, ...indexes] : [...indexes, index];
  }, []);

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLLIElement>({
    count: voices.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => row,
    getItemKey,
    rangeExtractor,
    overscan: OVERSCAN_ROWS,
    scrollMargin: top,
  });

  function onFocus(event: FocusEvent<HTMLUListElement>): void {
    const index = event.target.closest('li')?.dataset['index'];
    focusedRef.current = index === undefined ? null : Number(index);
  }

  return (
    <ul
      ref={listRef}
      onFocus={onFocus}
      onBlur={() => {
        focusedRef.current = null;
      }}
      style={{ height: virtualizer.getTotalSize() }}
      className="relative -mx-section"
    >
      {virtualizer.getVirtualItems().map(({ key, index, start, size }) => {
        const voice = voices[index];
        if (voice === undefined) return null;
        const { artistId, name, artHash, score } = voice;
        return (
          <li
            key={key}
            data-index={index}
            aria-setsize={voices.length}
            aria-posinset={index + 1}
            style={{ top: start - top, height: size }}
            className="absolute inset-x-0"
          >
            <Button variant="row" size="row" onClick={() => onOpenArtist(artistId)} className="px-section">
              <AlbumArt hash={artHash} title={name} className="size-10 shrink-0" />
              <Text truncate className="min-w-0 flex-1">
                {name}
              </Text>
              <Text variant="meta" color="muted" className="shrink-0">
                {strengthWords(score)}
              </Text>
            </Button>
            {index > 0 ? <Divider className="absolute inset-x-0 top-0" /> : null}
          </li>
        );
      })}
    </ul>
  );
}
