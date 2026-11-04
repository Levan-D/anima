import { useQuery } from '@tanstack/react-query';
import { FileInput, Plus } from 'lucide-react';
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
import { askForNewPlaylist, importPlaylist } from '@/lib/playlistActions';
import { playlistsQuery } from '@/lib/playlistQueries';

const PLAYLISTS_LIST = placeKey({ kind: 'tab', tab: 'playlists' });

function PlaylistButtons() {
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="compact" onClick={() => importPlaylist(openPlaylist)}>
        <FileInput aria-hidden />
        Import
      </Button>
      <Button variant="ghost" size="compact" onClick={() => askForNewPlaylist([])}>
        <Plus aria-hidden />
        New playlist
      </Button>
    </div>
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
          <PlaylistButtons />
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
        description="Make one here, or from any track's menu, or bring one in from an .m3u or .m3u8 file"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => askForNewPlaylist([])}>New playlist</Button>
            <Button variant="outline" onClick={() => importPlaylist(openPlaylist)}>
              Import
            </Button>
          </div>
        }
      />
    );
  }
  return <PlaylistListContents playlists={playlists.data} />;
}
