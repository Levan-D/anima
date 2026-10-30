import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { GenreSummary } from '@shared/domain';
import type { MusicSection } from '@/components/music/listItems';
import { ListSkeleton } from '@/components/music/ListSkeleton';
import { MusicList } from '@/components/music/MusicList';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListEmpty } from '@/features/Library/components/ListEmpty';
import { genresQuery } from '@/lib/libraryQueries';
import { openGenre, placeKey, selectTab } from '@/lib/navigation';

type ContentsProps = {
  genres: GenreSummary[];
};

function GenresContents({ genres }: ContentsProps) {
  const sections = useMemo((): MusicSection[] => [{ kind: 'genres', genres }], [genres]);

  return (
    <MusicList
      label="Genres"
      sections={sections}
      memoryKey={placeKey({ kind: 'tab', tab: 'genres' })}
      onOpenGenre={openGenre}
    />
  );
}

export function GenresView() {
  const genres = useQuery(genresQuery);

  if (genres.isPending) return <ListSkeleton kind="rows" />;
  if (genres.isError) return <ErrorState error={genres.error} onRetry={() => void genres.refetch()} />;
  if (genres.data.length === 0) {
    return (
      <ListEmpty
        skeleton="rows"
        title="No genres yet"
        description="None of your tracks has a genre tag"
        action={<Button onClick={() => selectTab('tracks')}>Browse tracks</Button>}
      />
    );
  }
  return <GenresContents genres={genres.data} />;
}
