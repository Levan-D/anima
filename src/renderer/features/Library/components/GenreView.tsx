import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { ArtistSummary, GenreSummary, Track } from '@shared/domain';
import type { MusicSection } from '@/components/music/listItems';
import { ListSkeleton } from '@/components/music/ListSkeleton';
import { MusicList } from '@/components/music/MusicList';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { DetailHeader } from '@/components/music/DetailHeader';
import { PlayAllButton } from '@/components/music/PlayAllButton';
import { formatPlural, joinParts } from '@/lib/format';
import { artistsInGenreQuery, genresQuery, tracksQuery } from '@/lib/libraryQueries';
import { goBack, openArtist, placeKey } from '@/lib/navigation';

type ContentsProps = {
  genre: GenreSummary;
  artists: ArtistSummary[];
  /** Everything in the genre, for playing all of it. */
  tracks: Track[];
};

function GenreContents({ genre, artists, tracks }: ContentsProps) {
  const sections = useMemo((): MusicSection[] => [{ kind: 'artists', artists }], [artists]);

  return (
    <MusicList
      label={`${genre.name} artists`}
      sections={sections}
      memoryKey={placeKey({ kind: 'genre', genreId: genre.id })}
      onOpenArtist={openArtist}
      header={
        <DetailHeader
          title={genre.name}
          meta={joinParts(formatPlural(artists.length, 'artist'), formatPlural(genre.trackCount, 'track'))}
          action={<PlayAllButton tracks={tracks} />}
        />
      }
    />
  );
}

type Props = {
  genreId: number;
};

export function GenreView({ genreId }: Props) {
  const genres = useQuery(genresQuery);
  const artists = useQuery(artistsInGenreQuery(genreId));
  const tracks = useQuery(tracksQuery({ kind: 'genre', genreId }));

  if (genres.isPending || artists.isPending || tracks.isPending) return <ListSkeleton kind="rows" />;
  if (genres.isError) return <ErrorState error={genres.error} onRetry={() => void genres.refetch()} />;
  if (artists.isError) return <ErrorState error={artists.error} onRetry={() => void artists.refetch()} />;
  if (tracks.isError) return <ErrorState error={tracks.error} onRetry={() => void tracks.refetch()} />;

  const genre = genres.data.find(({ id }) => id === genreId);
  if (!genre || tracks.data.length === 0) {
    return (
      <EmptyState
        title="Nothing left in this genre"
        description="Its tracks aren't on this device any more"
        action={<Button onClick={goBack}>Back</Button>}
      />
    );
  }
  return <GenreContents genre={genre} artists={artists.data} tracks={tracks.data} />;
}
