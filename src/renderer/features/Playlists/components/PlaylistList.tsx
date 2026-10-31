import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useMemo } from 'react';
import type { PlaylistSummary } from '@shared/domain';
import type { MusicSection } from '@/components/music/listItems';
import { ListSkeleton } from '@/components/music/ListSkeleton';
import { MusicList } from '@/components/music/MusicList';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Text } from '@/components/ui/Text';
import { formatPlural } from '@/lib/format';
import { openPlaylist, placeKey } from '@/lib/navigation';
import { askForNewPlaylist } from '@/lib/playlistActions';
import { playlistsQuery } from '@/lib/playlistQueries';

const PLAYLISTS_LIST = placeKey({ kind: 'tab', tab: 'playlists' });

function NewPlaylistButton() {
  return (
    <Button variant="ghost" size="compact" onClick={() => askForNewPlaylist([])}>
      <Plus aria-hidden />
      New playlist
    </Button>
  );
}

type ContentsProps = {
  playlists: PlaylistSummary[];
};

function PlaylistListContents({ playlists }: ContentsProps) {
  const sections = useMemo((): MusicSection[] => [{ kind: 'playlists', playlists }], [playlists]);

  return (
    <MusicList
      label="Playlists"
      sections={sections}
      memoryKey={PLAYLISTS_LIST}
      onOpenPlaylist={openPlaylist}
      header={
        <div className="flex items-center justify-between gap-gap pr-1 pl-gutter">
          <Text as="p" variant="meta" color="muted" tabular truncate>
            {formatPlural(playlists.length, 'playlist')}
          </Text>
          <NewPlaylistButton />
        </div>
      }
    />
  );
}

export function PlaylistList() {
  const playlists = useQuery(playlistsQuery);

  if (playlists.isPending) return <ListSkeleton kind="rows" />;
  if (playlists.isError) return <ErrorState error={playlists.error} onRetry={() => void playlists.refetch()} />;
  if (playlists.data.length === 0) {
    return (
      <EmptyState
        title="No playlists yet"
        description="Make one here, or from any track's menu"
        action={<Button onClick={() => askForNewPlaylist([])}>New playlist</Button>}
      />
    );
  }
  return <PlaylistListContents playlists={playlists.data} />;
}
