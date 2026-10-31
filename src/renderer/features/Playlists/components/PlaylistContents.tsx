import { ArrowDown, ArrowUp, ListMinus, ListX, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import type { PlaylistDetail, PlaylistSummary, Track } from '@shared/domain';
import { DetailHeader } from '@/components/music/DetailHeader';
import type { MusicSection, TrackItem } from '@/components/music/listItems';
import { MusicList } from '@/components/music/MusicList';
import { PlayAllButton } from '@/components/music/PlayAllButton';
import { PlaylistNameDialog } from '@/components/music/PlaylistNameDialog';
import { selectionMenuEntries, trackFileEntries, trackMenuEntries } from '@/components/music/trackMenuEntries';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import { EmptyState } from '@/components/ui/EmptyState';
import type { MenuEntry } from '@/components/ui/menuEntries';
import { placeInPlaylist, playableItems } from '@/features/Playlists/utils/playlistOrder';
import { formatPlural, formatSpan, joinParts } from '@/lib/format';
import { goBack, placeKey, selectTab } from '@/lib/navigation';
import { playTracks } from '@/lib/playerActions';
import {
  deletePlaylist,
  movePlaylistItems,
  removeFromPlaylist,
  removeMissingFromPlaylist,
  renamePlaylist,
} from '@/lib/playlistActions';

const NOT_HERE = 'Not on this device';

type OpenDialog = 'rename' | 'delete' | 'remove-missing' | null;

type Props = {
  playlist: PlaylistDetail;
};

export function PlaylistContents({ playlist }: Props) {
  const { id, name, items, trackCount, missingCount, durationMs, artHash } = playlist;
  const [dialog, setDialog] = useState<OpenDialog>(null);

  const playable = useMemo(() => playableItems(items), [items]);
  const missing = useMemo(() => items.filter(({ track }) => track.isMissing), [items]);
  const playableTracks = useMemo(() => playable.map(({ track }) => track), [playable]);

  const sections = useMemo(
    (): MusicSection[] => [
      { kind: 'playlistItems', items: playable, canReorder: true },
      ...(missing.length === 0
        ? []
        : ([
            { kind: 'label', text: NOT_HERE },
            { kind: 'playlistItems', items: missing, canReorder: false },
          ] satisfies MusicSection[])),
    ],
    [missing, playable],
  );

  // Each item has its own track object, so this finds the very row even when a track is in here twice.
  const play = useCallback((track: Track) => playTracks(playableTracks, track), [playableTracks]);

  const move = useCallback(
    (itemIds: number[], toIndex: number) => movePlaylistItems(id, itemIds, placeInPlaylist(items, itemIds, toIndex)),
    [id, items],
  );

  function menuFor({ track, itemId }: TrackItem, playlists: readonly PlaylistSummary[]): MenuEntry[] {
    if (itemId === null) return [];
    const remove: MenuEntry = {
      kind: 'item',
      label: 'Remove from playlist',
      icon: ListX,
      onSelect: () => removeFromPlaylist(id, [itemId]),
    };

    if (track.isMissing) {
      return [
        ...trackFileEntries(track, playlists),
        { kind: 'separator' },
        remove,
        {
          kind: 'item',
          label: 'Remove missing…',
          icon: ListMinus,
          destructive: true,
          onSelect: () => setDialog('remove-missing'),
        },
      ];
    }

    const place = playable.findIndex((item) => item.itemId === itemId);
    return [
      ...trackMenuEntries(track, () => play(track), { isInAlbum: false }, playlists),
      { kind: 'separator' },
      {
        kind: 'item',
        label: 'Move up',
        icon: ArrowUp,
        disabled: place <= 0,
        onSelect: () => move([itemId], place - 1),
      },
      {
        kind: 'item',
        label: 'Move down',
        icon: ArrowDown,
        disabled: place === playable.length - 1,
        onSelect: () => move([itemId], place + 1),
      },
      { kind: 'separator' },
      remove,
    ];
  }

  function selectionMenuFor(group: readonly TrackItem[], playlists: readonly PlaylistSummary[]): MenuEntry[] {
    return [
      ...selectionMenuEntries(
        group.map(({ track }) => track),
        playlists,
      ),
      { kind: 'separator' },
      {
        kind: 'item',
        label: 'Remove from playlist',
        icon: ListX,
        onSelect: () =>
          removeFromPlaylist(
            id,
            group.flatMap(({ itemId }) => itemId ?? []),
          ),
      },
    ];
  }

  const missingWords = missingCount > 0 ? `${missingCount} not on this device` : null;
  const header = (
    <DetailHeader
      title={name}
      art={{ hash: artHash }}
      meta={joinParts(formatPlural(trackCount, 'track'), durationMs > 0 ? formatSpan(durationMs) : null, missingWords)}
      action={
        <div className="flex flex-wrap items-center gap-2">
          {playableTracks.length > 0 ? <PlayAllButton tracks={playableTracks} /> : null}
          {missingCount > 0 ? (
            <Button variant="ghost" onClick={() => setDialog('remove-missing')}>
              Remove missing
            </Button>
          ) : null}
          <DropdownMenu
            align="start"
            entries={[
              { kind: 'item', label: 'Rename', icon: Pencil, onSelect: () => setDialog('rename') },
              {
                kind: 'item',
                label: 'Delete',
                icon: Trash2,
                destructive: true,
                onSelect: () => setDialog('delete'),
              },
            ]}
          >
            <Button variant="ghost" size="icon" aria-label="Playlist actions">
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenu>
        </div>
      }
    />
  );

  return (
    <>
      {items.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {header}
          <EmptyState
            title="Nothing in here yet"
            description="Add tracks from any track's menu"
            action={<Button onClick={() => selectTab('albums')}>Browse albums</Button>}
            className="h-auto flex-1"
          />
        </div>
      ) : (
        <MusicList
          label={`Tracks in ${name}`}
          sections={sections}
          memoryKey={placeKey({ kind: 'playlist', playlistId: id })}
          onPlayTrack={play}
          menuFor={menuFor}
          selectionMenuFor={selectionMenuFor}
          onReorder={move}
          header={header}
        />
      )}

      {dialog === 'rename' ? (
        <PlaylistNameDialog
          title="Rename playlist"
          submitLabel="Rename"
          initialName={name}
          onSubmit={(next) => renamePlaylist(id, next)}
          onClose={() => setDialog(null)}
        />
      ) : null}

      <Dialog
        open={dialog === 'delete'}
        onOpenChange={() => setDialog(null)}
        title={`Delete ${name}?`}
        description="The playlist goes. Its tracks stay in the library, and your files aren't touched."
        actions={[
          <Button key="keep" variant="outline">
            Keep it
          </Button>,
          <Button
            key="delete"
            variant="danger"
            onClick={() => {
              goBack();
              deletePlaylist(id);
            }}
          >
            Delete it
          </Button>,
        ]}
      />

      <Dialog
        open={dialog === 'remove-missing'}
        onOpenChange={() => setDialog(null)}
        title={`Remove ${formatPlural(missing.length, 'track')} from ${name}?`}
        description="They aren't on this device right now. If their files come back, they won't be in this playlist any more. Your other playlists keep theirs."
        actions={[
          <Button key="keep" variant="outline">
            Keep them
          </Button>,
          <Button key="remove" variant="danger" onClick={() => removeMissingFromPlaylist(id)}>
            Remove them
          </Button>,
        ]}
      />
    </>
  );
}
