import { memo, useCallback, useMemo, type ReactNode } from 'react';
import type { Track } from '@shared/domain';
import { AlbumCard } from '@/components/music/AlbumCard';
import { AlbumRow } from '@/components/music/AlbumRow';
import { ArtistRow } from '@/components/music/ArtistRow';
import { GenreRow } from '@/components/music/GenreRow';
import {
  cellKeyOf,
  focusableIn,
  keyOf,
  toMusicItems,
  type MusicItem,
  type MusicSection,
} from '@/components/music/listItems';
import { TrackRow } from '@/components/music/TrackRow';
import { Text } from '@/components/ui/Text';
import { VirtualList } from '@/components/ui/VirtualList';
import { useElementSize } from '@/hooks/useElementSize';
import { focusAboveList } from '@/lib/listDom';
import { albumLayout, useListMetrics } from '@/lib/listMetrics';

const NOOP = () => {};

type Handlers = {
  onPlayTrack?: (track: Track) => void;
  onOpenAlbum?: (albumId: number) => void;
  onOpenArtist?: (artistId: number) => void;
  onOpenGenre?: (genreId: number) => void;
};

type ItemProps = Required<Handlers> & {
  item: MusicItem;
};

const MusicRow = memo(function MusicRow({ item, onPlayTrack, onOpenAlbum, onOpenArtist, onOpenGenre }: ItemProps) {
  switch (item.kind) {
    case 'label':
      return (
        <div className="flex h-full items-end px-gutter pb-2">
          <Text as="h2" variant="label" color="muted" truncate>
            {item.text}
          </Text>
        </div>
      );
    case 'albumLane':
      return (
        <div className="flex gap-gap px-gutter">
          {item.albums.map((album) => (
            <AlbumCard key={album.id} album={album} hideArtist={item.hideArtist} onOpen={onOpenAlbum} />
          ))}
          {/* A short last row keeps its cards the same width as the rest. */}
          {Array.from({ length: item.lanes - item.albums.length }, (_, index) => (
            <span key={index} aria-hidden className="min-w-0 flex-1" />
          ))}
        </div>
      );
    case 'albumRow':
      return <AlbumRow album={item.album} onOpen={onOpenAlbum} />;
    case 'artist':
      return <ArtistRow artist={item.artist} onOpen={onOpenArtist} />;
    case 'genre':
      return <GenreRow genre={item.genre} onOpen={onOpenGenre} />;
    case 'track':
      return <TrackRow track={item.track} numbered={item.numbered} onPlay={onPlayTrack} />;
  }
});

type Props = Handlers & {
  label: string;
  sections: readonly MusicSection[];
  /** Names this list's place, so coming back to it restores the scroll position. */
  memoryKey: string;
  /** A new value means it's a different list now, starting from the top, without remounting what's the same in both. */
  resetKey?: string;
  header?: ReactNode;
};

/**
 * Anything the library shows as a list: sections go in, and it works out the sizes, the album lanes and what's on
 * screen. Sizes come from the fluid tokens, so they stay right through a resize or a change of interface size.
 */
export function MusicList({
  label,
  sections,
  memoryKey,
  resetKey,
  header,
  onPlayTrack = NOOP,
  onOpenAlbum = NOOP,
  onOpenArtist = NOOP,
  onOpenGenre = NOOP,
}: Props) {
  const metrics = useListMetrics();
  const [contentRef, { width }] = useElementSize<HTMLDivElement>();
  const { lanes, rowHeight } = albumLayout(width, metrics);
  const { row, label: labelHeight, gutter } = metrics;

  // Until the first measurement there's no telling how many lanes fit, and no point building rows to throw away.
  const isMeasured = width > 0;
  const items = useMemo(() => (isMeasured ? toMusicItems(sections, lanes) : []), [isMeasured, lanes, sections]);

  const getSize = useCallback(
    (item: MusicItem) => {
      if (item.kind === 'label') return labelHeight;
      return item.kind === 'albumLane' ? rowHeight : row;
    },
    [labelHeight, row, rowHeight],
  );

  const renderItem = useCallback(
    (item: MusicItem) => (
      <MusicRow
        item={item}
        onPlayTrack={onPlayTrack}
        onOpenAlbum={onOpenAlbum}
        onOpenArtist={onOpenArtist}
        onOpenGenre={onOpenGenre}
      />
    ),
    [onOpenAlbum, onOpenArtist, onOpenGenre, onPlayTrack],
  );

  return (
    <VirtualList
      label={label}
      items={items}
      getKey={keyOf}
      getSize={getSize}
      getColumns={focusableIn}
      getCellKey={cellKeyOf}
      renderItem={renderItem}
      memoryKey={memoryKey}
      layoutKey={isMeasured ? `${row}/${labelHeight}/${rowHeight}/${lanes}` : null}
      {...(resetKey === undefined ? {} : { resetKey })}
      header={header}
      contentRef={contentRef}
      paddingStart={header ? 0 : Math.round(metrics.gap)}
      paddingEnd={gutter}
      scrollPadding={Math.ceil(metrics.gap)}
      onLeaveTop={focusAboveList}
    />
  );
}
