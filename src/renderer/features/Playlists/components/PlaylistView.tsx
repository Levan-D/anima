import { useQuery } from '@tanstack/react-query';
import { ListSkeleton } from '@/components/music/ListSkeleton';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { PlaylistContents } from '@/features/Playlists/components/PlaylistContents';
import { isNotFound } from '@/lib/api';
import { goBack } from '@/lib/navigation';
import { playlistQuery } from '@/lib/playlistQueries';

type Props = {
  playlistId: number;
};

export function PlaylistView({ playlistId }: Props) {
  const playlist = useQuery(playlistQuery(playlistId));

  if (playlist.isPending) return <ListSkeleton kind="rows" />;
  if (isNotFound(playlist.error)) {
    return (
      <EmptyState
        title="This playlist has gone"
        description="It isn't in this library any more"
        action={<Button onClick={goBack}>Back</Button>}
      />
    );
  }
  if (playlist.isError) return <ErrorState error={playlist.error} onRetry={() => void playlist.refetch()} />;
  return <PlaylistContents playlist={playlist.data} />;
}
