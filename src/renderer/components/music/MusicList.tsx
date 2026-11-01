import { memo, useCallback, useMemo, type ReactNode } from 'react';
import type { PlaylistSummary, Track } from '@shared/domain';
import { AlbumCard } from '@/components/music/AlbumCard';
import { AlbumRow } from '@/components/music/AlbumRow';
import { ArtistRow } from '@/components/music/ArtistRow';
import { GenreRow } from '@/components/music/GenreRow';
import {
  cellKeyOf,
  draggedWith,
  dragIdsOf,
  focusableIn,
  keyOf,
  toMusicItems,
  type MusicItem,
  type MusicSection,
  type TrackItem,
} from '@/components/music/listItems';
import { PlaylistRow } from '@/components/music/PlaylistRow';
import { SelectionBar } from '@/components/music/SelectionBar';
import { TrackMenu } from '@/components/music/TrackMenu';
import { selectionMenuEntries, trackMenuEntries } from '@/components/music/trackMenuEntries';
import { TrackRow } from '@/components/music/TrackRow';
import { useListSelection } from '@/components/music/useListSelection';
import { DragReorder } from '@/components/ui/DragReorder';
import type { MenuEntry } from '@/components/ui/menuEntries';
import { Text } from '@/components/ui/Text';
import { VirtualList } from '@/components/ui/VirtualList';
import { useElementSize } from '@/hooks/useElementSize';
import { focusAboveList } from '@/lib/listDom';
import { albumLayout, useListMetrics } from '@/lib/listMetrics';
import { extendSelection, isSelectionShowing, selectedKeys, useSelection } from '@/lib/selection';

const NOOP = () => {};

function defaultSelectionMenu(group: readonly TrackItem[], playlists: readonly PlaylistSummary[]): MenuEntry[] {
  return selectionMenuEntries(
    group.map(({ track }) => track),
    playlists,
  );
}

function extendOverRows(from: MusicItem, to: MusicItem): void {
  if (from.kind === 'track' && to.kind === 'track') extendSelection(from.key, to.key);
}

type Handlers = {
  onPlayTrack?: (track: Track, queueIndex: number | null) => void;
  onOpenAlbum?: (albumId: number) => void;
  onOpenArtist?: (artistId: number) => void;
  onOpenGenre?: (genreId: number) => void;
  onOpenPlaylist?: (playlistId: number) => void;
};

type ItemProps = Required<Handlers> & {
  item: MusicItem;
};

const MusicRow = memo(function MusicRow({
  item,
  onPlayTrack,
  onOpenAlbum,
  onOpenArtist,
  onOpenGenre,
  onOpenPlaylist,
}: ItemProps) {
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
    case 'playlist':
      return <PlaylistRow playlist={item.playlist} onOpen={onOpenPlaylist} />;
    case 'track':
      return (
        <TrackRow
          track={item.track}
          numbered={item.numbered}
          queueIndex={item.queueIndex}
          dragId={item.dragId}
          isInReorderableList={item.itemId !== null}
          selectionKey={item.key}
          onPlay={onPlayTrack}
        />
      );
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
  /** What a track row's menu offers, if it isn't the usual. */
  menuFor?: (item: TrackItem, playlists: readonly PlaylistSummary[]) => MenuEntry[];
  /** The same for several selected rows, when the pressed one is among them. */
  selectionMenuFor?: (group: readonly TrackItem[], playlists: readonly PlaylistSummary[]) => MenuEntry[];
  /** Rows in sections that can be reordered can then be dragged. `toIndex` is counted in the rows that can, without them. */
  onReorder?: (ids: number[], toIndex: number) => void;
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
  menuFor,
  selectionMenuFor = defaultSelectionMenu,
  onReorder,
  onPlayTrack = NOOP,
  onOpenAlbum = NOOP,
  onOpenArtist = NOOP,
  onOpenGenre = NOOP,
  onOpenPlaylist = NOOP,
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
        onOpenPlaylist={onOpenPlaylist}
      />
    ),
    [onOpenAlbum, onOpenArtist, onOpenGenre, onOpenPlaylist, onPlayTrack],
  );

  const entriesFor =
    menuFor ??
    ((item: TrackItem, playlists: readonly PlaylistSummary[]) =>
      trackMenuEntries(
        item.track,
        () => onPlayTrack(item.track, item.queueIndex),
        { isInAlbum: item.numbered },
        playlists,
      ));

  const dragIds = useMemo(() => dragIdsOf(items), [items]);
  const movingWith = useCallback((dragId: number) => draggedWith(items, selectedKeys(), dragId), [items]);

  useListSelection(resetKey === undefined ? memoryKey : `${memoryKey}|${resetKey}`, items);
  const isBarShowing = useSelection(isSelectionShowing);
  const rowCount = useMemo(() => items.filter(({ kind }) => kind === 'track').length, [items]);
  // Clear of the transport's fade, so nothing focused is under it, and of the selection bar when that's there too.
  const endRoom = Math.max(gutter, metrics.listFade) + (isBarShowing ? row + Math.ceil(metrics.gap) : 0);

  const list = (
    <TrackMenu items={items} entriesFor={entriesFor} groupEntriesFor={selectionMenuFor}>
      {/* Radix needs one element to hang its handlers on, and the list is laid out by what's around this. */}
      <div className="contents">
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
          paddingEnd={endRoom}
          scrollPadding={Math.ceil(metrics.gap)}
          scrollPaddingEnd={endRoom}
          onLeaveTop={focusAboveList}
          onShiftMove={extendOverRows}
          className="content-in"
        />
      </div>
    </TrackMenu>
  );

  return (
    <>
      {onReorder ? (
        <DragReorder ids={dragIds} onMove={onReorder} movingWith={movingWith}>
          {list}
        </DragReorder>
      ) : (
        list
      )}
      <SelectionBar total={rowCount} />
    </>
  );
}
