import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { AlbumSummary } from '@shared/domain';
import type { MusicSection } from '@/components/music/listItems';
import { ListSkeleton } from '@/components/music/ListSkeleton';
import { MusicList } from '@/components/music/MusicList';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListEmpty } from '@/features/Library/components/ListEmpty';
import { albumsQuery } from '@/lib/libraryQueries';
import { openAlbum, placeKey, selectTab } from '@/lib/navigation';

const EVERY_ALBUM = { artistId: null, genreId: null };

type ContentsProps = {
  albums: AlbumSummary[];
};

function AlbumsContents({ albums }: ContentsProps) {
  const sections = useMemo((): MusicSection[] => [{ kind: 'albums', albums, hideArtist: false }], [albums]);

  return (
    <MusicList
      label="Albums"
      sections={sections}
      memoryKey={placeKey({ kind: 'tab', tab: 'albums' })}
      onOpenAlbum={openAlbum}
    />
  );
}

export function AlbumsView() {
  const albums = useQuery(albumsQuery(EVERY_ALBUM));

  if (albums.isPending) return <ListSkeleton kind="grid" />;
  if (albums.isError) return <ErrorState error={albums.error} onRetry={() => void albums.refetch()} />;
  if (albums.data.length === 0) {
    return (
      <ListEmpty
        skeleton="grid"
        title="No albums yet"
        description="None of your tracks has an album tag"
        action={<Button onClick={() => selectTab('tracks')}>Browse tracks</Button>}
      />
    );
  }
  return <AlbumsContents albums={albums.data} />;
}
