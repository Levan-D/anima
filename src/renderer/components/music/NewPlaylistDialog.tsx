import { PlaylistEditor } from '@/components/music/PlaylistEditor';
import { NameDialog } from '@/components/ui/NameDialog';
import { formatPlural } from '@/lib/format';
import { focusCurrentList } from '@/lib/listDom';
import { openPlaylist } from '@/lib/navigation';
import { closeNewPlaylistPrompt, createPlaylist, useNewPlaylistPrompt } from '@/lib/playlistActions';
import { showToast } from '@/lib/toastStore';

/**
 * One for the app, opened with `askForNewPlaylist`. From a track's menu it only asks for a name and stays where it is.
 * Empty, it's the editor, for a name and songs picked by search, and goes to the new playlist.
 */
export function NewPlaylistDialog() {
  const trackIds = useNewPlaylistPrompt();
  if (trackIds === null) return null;

  const isFromMenu = trackIds.length > 0;
  if (!isFromMenu) {
    return (
      <PlaylistEditor
        title="New playlist"
        submitLabel="Create"
        onClose={closeNewPlaylistPrompt}
        onSubmit={async ({ name, trackIds: picked }) => {
          const created = await createPlaylist(name, picked);
          if (created.ok) openPlaylist(created.value.id);
          return created;
        }}
      />
    );
  }

  return (
    <NameDialog
      fieldLabel="Playlist name"
      title="New playlist"
      submitLabel="Create"
      onClose={closeNewPlaylistPrompt}
      // What had focus was the menu's item, which has gone. The list it was opened on hasn't.
      onCloseAutoFocus={(event: Event) => {
        event.preventDefault();
        focusCurrentList();
      }}
      onSubmit={async (name) => {
        const created = await createPlaylist(name, trackIds);
        if (created.ok) showToast({ message: `Added ${formatPlural(trackIds.length, 'track')} to ${name}` });
        return created;
      }}
    />
  );
}
