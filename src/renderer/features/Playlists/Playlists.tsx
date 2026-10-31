import { PlaylistList } from '@/features/Playlists/components/PlaylistList';
import { PlaylistView } from '@/features/Playlists/components/PlaylistView';
import { currentPlace, useNavigation } from '@/lib/navigation';

export function Playlists() {
  const place = useNavigation(currentPlace);
  return place.kind === 'playlist' ? (
    <PlaylistView key={place.playlistId} playlistId={place.playlistId} />
  ) : (
    <PlaylistList />
  );
}
