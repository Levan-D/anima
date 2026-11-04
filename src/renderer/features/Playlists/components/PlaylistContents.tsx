import { FileOutput, ListMinus, MoreHorizontal, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import type { PlaylistDetail, PlaylistSummary, Track } from '@shared/domain';
import { DetailHeader } from '@/components/music/DetailHeader';
import type { MusicSection, TrackItem } from '@/components/music/listItems';
import { MusicList } from '@/components/music/MusicList';
import { PlayAllButton } from '@/components/music/PlayAllButton';
import { PlaylistCover } from '@/components/music/PlaylistCover';
import { PlaylistEditor } from '@/components/music/PlaylistEditor';
import { selectionMenuEntries, trackFileEntries, trackMenuEntries } from '@/components/music/trackMenuEntries';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import type { MenuEntry } from '@/components/ui/menuEntries';
import { playableItems } from '@/features/Playlists/utils/playlistOrder';
import { formatPlural, formatSpan, joinParts } from '@/lib/format';
import { goBack, openSimilarToPlaylist, placeKey } from '@/lib/navigation';
import { playTracks } from '@/lib/playerActions';
import { deletePlaylist, exportPlaylist, removeMissingFromPlaylist, savePlaylist } from '@/lib/playlistActions';

const NOT_HERE = 'Not on this device';

type OpenDialog = 'edit' | 'delete' | 'remove-missing' | null;

type Props = {
  playlist: PlaylistDetail;
};

export function PlaylistContents({ playlist }: Props) {
  const { id, name, items, trackCount, missingCount, durationMs, covers } = playlist;
  const [dialog, setDialog] = useState<OpenDialog>(null);

  const playable = useMemo(() => playableItems(items), [items]);
  const missing = useMemo(() => items.filter(({ track }) => track.isMissing), [items]);
  const playableTracks = useMemo(() => playable.map(({ track }) => track), [playable]);

  const sections = useMemo(
    (): MusicSection[] => [
      { kind: 'playlistItems', items: playable, canReorder: false },
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

  // Read-only here: what's in it, and in what order, only changes in the editor, and only when it's saved.
  function menuFor({ track, itemId }: TrackItem, playlists: readonly PlaylistSummary[]): MenuEntry[] {
    if (itemId === null) return [];
    return track.isMissing
      ? trackFileEntries(track, playlists)
      : trackMenuEntries(track, () => play(track), { isInAlbum: false }, playlists);
  }

  function selectionMenuFor(group: readonly TrackItem[], playlists: readonly PlaylistSummary[]): MenuEntry[] {
    return selectionMenuEntries(
      group.map(({ track }) => track),
      playlists,
    );
  }

  const tracksIn = useMemo(() => items.map(({ track }) => track), [items]);

  const missingWords = missingCount > 0 ? `${missingCount} not on this device` : null;
  const header = (
    <DetailHeader
      title={name}
      {...(items.length === 0
        ? {}
        : { cover: <PlaylistCover covers={covers} title={name} size="full" className="w-full" /> })}
      meta={joinParts(formatPlural(trackCount, 'track'), durationMs > 0 ? formatSpan(durationMs) : null, missingWords)}
      action={
        <div className="flex flex-wrap items-center gap-2">
          {playableTracks.length > 0 ? <PlayAllButton tracks={playableTracks} /> : null}
          {items.length === 0 ? (
            <Button variant="primary" onClick={() => setDialog('edit')}>
              <Plus aria-hidden />
              Add songs
            </Button>
          ) : null}
          <DropdownMenu
            align="start"
            entries={[
              { kind: 'item', label: 'Edit', icon: Pencil, onSelect: () => setDialog('edit') },
              {
                kind: 'item',
                label: 'More like this',
                icon: Sparkles,
                disabled: items.length === 0,
                onSelect: () => openSimilarToPlaylist(id, name),
              },
              {
                kind: 'item',
                label: 'Export…',
                icon: FileOutput,
                disabled: items.length === 0,
                onSelect: () => exportPlaylist(id, name),
              },
              ...(missingCount > 0
                ? [
                    {
                      kind: 'item',
                      label: 'Remove missing…',
                      icon: ListMinus,
                      destructive: true,
                      onSelect: () => setDialog('remove-missing'),
                    } satisfies MenuEntry,
                  ]
                : []),
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
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{header}</div>
      ) : (
        <MusicList
          label={`Tracks in ${name}`}
          sections={sections}
          memoryKey={placeKey({ kind: 'playlist', playlistId: id })}
          onPlayTrack={play}
          menuFor={menuFor}
          selectionMenuFor={selectionMenuFor}
          header={header}
        />
      )}

      {dialog === 'edit' ? (
        <PlaylistEditor
          title="Edit playlist"
          submitLabel="Save"
          initialName={name}
          initialTracks={tracksIn}
          onSubmit={({ name: nextName, trackIds }) => savePlaylist(id, nextName, trackIds)}
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
