import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type { DiscoverArtist } from '@shared/domain';
import { ListSkeleton } from '@/components/music/ListSkeleton';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Text } from '@/components/ui/Text';
import { VirtualList } from '@/components/ui/VirtualList';
import { useElementSize } from '@/hooks/useElementSize';
import { formatPlural, joinParts } from '@/lib/format';
import { discoverQuery } from '@/lib/libraryQueries';
import { useListMetrics } from '@/lib/listMetrics';
import { openSettings } from '@/lib/settingsDialog';

const NAMES_SHOWN = 3;
const DISCOVER_LIST = 'discover';

function recommendedByWords(names: readonly string[]): string {
  const shown = names.slice(0, NAMES_SHOWN).join(', ');
  const others = names.length - NAMES_SHOWN;
  return others > 0 ? `From ${shown} and ${formatPlural(others, 'other')}` : `From ${shown}`;
}

const keyOf = ({ key }: DiscoverArtist) => key;
const oneColumn = () => 1;

type RowProps = {
  artist: DiscoverArtist;
};

/**
 * Names to go and look for: it isn't in the library, so there's nothing to do with one here. It's a button only because
 * that's what a list's keyboard lands on, which is how this gets read from the couch.
 */
function DiscoverRow({ artist }: RowProps) {
  const details = joinParts(recommendedByWords(artist.recommendedBy), artist.tracks.join(', '));

  return (
    <Button variant="row" size="row" tabIndex={-1} data-testid="discover-row" title={details}>
      <span className="flex min-w-0 flex-1 flex-col">
        <Text truncate>{artist.name}</Text>
        <Text variant="meta" color="muted" truncate>
          {details}
        </Text>
      </span>
    </Button>
  );
}

type ContentsProps = {
  artists: DiscoverArtist[];
};

function DiscoverContents({ artists }: ContentsProps) {
  const metrics = useListMetrics();
  const [contentRef, { width }] = useElementSize<HTMLDivElement>();
  const getSize = useCallback(() => metrics.row, [metrics.row]);
  const renderItem = useCallback((artist: DiscoverArtist) => <DiscoverRow artist={artist} />, []);
  const header = useMemo(
    () => (
      <div className="px-gutter pt-gap pb-2">
        <Text as="p" variant="meta" color="muted" tabular>
          {`Music you might like that isn't in your library · ${formatPlural(artists.length, 'artist')}`}
        </Text>
      </div>
    ),
    [artists.length],
  );

  return (
    <VirtualList
      label="Music you might like"
      items={artists}
      getKey={keyOf}
      getSize={getSize}
      getColumns={oneColumn}
      getCellKey={keyOf}
      renderItem={renderItem}
      memoryKey={DISCOVER_LIST}
      layoutKey={width > 0 ? `${metrics.row}` : null}
      header={header}
      contentRef={contentRef}
      paddingEnd={Math.max(metrics.gutter, metrics.listFade)}
      scrollPadding={Math.ceil(metrics.gap)}
    />
  );
}

export function Discover() {
  const discover = useQuery(discoverQuery);

  if (discover.isPending) return <ListSkeleton kind="rows" />;
  if (discover.isError) return <ErrorState error={discover.error} onRetry={() => void discover.refetch()} />;
  if (discover.data.artists.length === 0) {
    return (
      <EmptyState
        title={discover.data.hasData ? 'Nothing new to suggest' : 'No listener data yet'}
        description={
          discover.data.hasData
            ? 'Everything listeners of your artists point at is already here'
            : 'Update listener data in Settings, under Data'
        }
        action={<Button onClick={() => openSettings('data')}>Open Data</Button>}
      />
    );
  }
  return <DiscoverContents artists={discover.data.artists} />;
}
