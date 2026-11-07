import { useQuery } from '@tanstack/react-query';
import { usePlayer } from '@/lib/playerStore';
import { playlistsQuery } from '@/lib/playlistQueries';

/** The playlist the queue was played from, by its name now, while it's still there to go back to. */
export function usePlayedFrom(): { id: number; name: string } | null {
  const playlistId = usePlayer((state) => (state.from?.kind === 'playlist' ? state.from.playlistId : null));
  const { data: name = null } = useQuery({
    ...playlistsQuery,
    enabled: playlistId !== null,
    select: (playlists) => playlists.find(({ id }) => id === playlistId)?.name ?? null,
  });
  return playlistId === null || name === null ? null : { id: playlistId, name };
}
