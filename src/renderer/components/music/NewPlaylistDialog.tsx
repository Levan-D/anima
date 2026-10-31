import { PlaylistNameDialog } from '@/components/music/PlaylistNameDialog';
import { formatPlural } from '@/lib/format';
import { focusCurrentList } from '@/lib/listDom';
import { openPlaylist } from '@/lib/navigation';
import { closeNewPlaylistPrompt, createPlaylist, useNewPlaylistPrompt } from '@/lib/playlistActions';
import { showToast } from '@/lib/toastStore';

/** One for the app, opened with `askForNewPlaylist`. Empty goes to the new playlist, and with tracks stays where it is. */
export function NewPlaylistDialog() {
  const trackIds = useNewPlaylistPrompt();
  if (trackIds === null) return null;

  const isFromMenu = trackIds.length > 0;

  return (
    <PlaylistNameDialog
      title="New playlist"
      submitLabel="Create"
      onClose={closeNewPlaylistPrompt}
      // What had focus was the menu's item, which has gone. The list it was opened on hasn't.
      {...(isFromMenu
        ? {
            onCloseAutoFocus(event: Event) {
              event.preventDefault();
              focusCurrentList();
            },
          }
        : {})}
      onSubmit={async (name) => {
        const created = await createPlaylist(name, trackIds);
        if (created.ok && isFromMenu) {
          showToast({ message: `Added ${formatPlural(trackIds.length, 'track')} to ${name}` });
        } else if (created.ok) {
          openPlaylist(created.value.id);
        }
        return created;
      }}
    />
  );
}
