import { memo, useCallback, useMemo, type ReactNode } from 'react';
import type { DiscoverArtist } from '@shared/domain';
import { VirtualList } from '@/components/ui/VirtualList';
import { useElementSize } from '@/hooks/useElementSize';
import { useListMetrics } from '@/lib/listMetrics';
import { toLanes, type Lane } from '@/features/Discover/utils/suggestions';
import { SuggestionRow } from './SuggestionRow';

const DISCOVER_LIST = 'discover';
// In album cards, the one width that knows about the interface size. About three lanes on a laptop, four on 16:9.
const LANE_IN_CARDS = 2.8;
const TALL_ROW_IN_ROWS = 1.75;
// In lanes, each of which is a few rows of stacked art.
const OVERSCAN_LANES = 2;

const keyOf = ({ key }: Lane) => key;
const columnsOf = ({ suggestions }: Lane) => suggestions.length;
const cellKeyOf = ({ suggestions }: Lane, column: number) => suggestions[column]?.key ?? '';

type LaneRowsProps = {
  lane: Lane;
  perLane: number;
  compact: boolean;
  onOpen: (artist: DiscoverArtist) => void;
};

// Memoized as a whole, since scrolling renders the list on every step and most lanes stay as they were.
const LaneRows = memo(function LaneRows({ lane, perLane, compact, onOpen }: LaneRowsProps) {
  return (
    <div className="flex h-full gap-gap px-[calc(var(--spacing-gutter)-var(--spacing)*2)]">
      {lane.suggestions.map((artist) => (
        <SuggestionRow key={artist.key} artist={artist} compact={compact} onOpen={onOpen} />
      ))}
      {Array.from({ length: perLane - lane.suggestions.length }, (_, index) => (
        <span key={index} className="min-w-0 flex-1 basis-0" />
      ))}
    </div>
  );
});

type Props = {
  label: string;
  artists: readonly DiscoverArtist[];
  compact: boolean;
  /** A new one starts it from the top. */
  resetKey: string;
  header: ReactNode;
  onOpen: (artist: DiscoverArtist) => void;
};

/** Rows in lanes, as many as the width takes. Virtual, since this can run to a couple of thousand. */
export function SuggestionList({ label, artists, compact, resetKey, header, onOpen }: Props) {
  const metrics = useListMetrics();
  const [contentRef, { width }] = useElementSize<HTMLDivElement>();
  const perLane = Math.max(1, Math.floor((width + metrics.gap) / (metrics.card * LANE_IN_CARDS + metrics.gap)));
  const lanes = useMemo(() => toLanes(artists, perLane), [artists, perLane]);
  const rowSize = Math.round(metrics.row * (compact ? 1 : TALL_ROW_IN_ROWS));
  const getSize = useCallback(() => rowSize, [rowSize]);

  const renderItem = useCallback(
    (lane: Lane) => <LaneRows lane={lane} perLane={perLane} compact={compact} onOpen={onOpen} />,
    [compact, onOpen, perLane],
  );

  return (
    <VirtualList
      label={label}
      items={lanes}
      getKey={keyOf}
      getSize={getSize}
      getColumns={columnsOf}
      getCellKey={cellKeyOf}
      renderItem={renderItem}
      memoryKey={DISCOVER_LIST}
      layoutKey={width > 0 ? `${rowSize}:${perLane}` : null}
      resetKey={resetKey}
      header={header}
      overscan={OVERSCAN_LANES}
      contentRef={contentRef}
      paddingEnd={metrics.islandClear}
      scrollPadding={Math.ceil(metrics.gap)}
      scrollPaddingEnd={metrics.islandClear}
      className="content-in"
    />
  );
}
