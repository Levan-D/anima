import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type { AlbumSummary, GenreSummary, Track } from '@shared/domain';
import type { MusicSection } from '@/components/music/listItems';
import { ListSkeleton } from '@/components/music/ListSkeleton';
import { MusicList } from '@/components/music/MusicList';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { DetailHeader } from '@/components/music/DetailHeader';
import { PlayAllButton } from '@/components/music/PlayAllButton';
import { formatPlural, joinParts } from '@/lib/format';
import { albumsQuery, genresQuery, tracksQuery } from '@/lib/libraryQueries';
import { goBack, openAlbum, placeKey } from '@/lib/navigation';
import { playTracks } from '@/lib/playerActions';

type ContentsProps = {
  genre: GenreSummary;
  albums: AlbumSummary[];
  /** Everything in the genre, for playing all of it. */
  tracks: Track[];
  /** Only the ones that aren't on any album, which would otherwise have nowhere to show up. */
  looseTracks: Track[];
};

function GenreContents({ genre, albums, tracks, looseTracks }: ContentsProps) {
  const sections = useMemo(
    (): MusicSection[] => [
      { kind: 'albums', albums, hideArtist: false },
      ...(looseTracks.length > 0
        ? ([
            { kind: 'label', text: 'Tracks' },
            { kind: 'tracks', tracks: looseTracks, numbered: false },
          ] as const)
        : []),
    ],
    [albums, looseTracks],
  );
  const play = useCallback((track: Track) => playTracks(looseTracks, track), [looseTracks]);

  return (
    <MusicList
      label={`${genre.name} albums`}
      sections={sections}
      memoryKey={placeKey({ kind: 'genre', genreId: genre.id })}
      onOpenAlbum={openAlbum}
      onPlayTrack={play}
      header={
        <DetailHeader
          title={genre.name}
          meta={joinParts(
            albums.length > 0 ? formatPlural(albums.length, 'album') : null,
            formatPlural(genre.trackCount, 'track'),
          )}
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
  const albums = useQuery(albumsQuery({ artistId: null, genreId }));
  const tracks = useQuery(tracksQuery({ kind: 'genre', genreId }));

  const looseTracks = useMemo(() => tracks.data?.filter(({ albumId }) => albumId === null) ?? [], [tracks.data]);

  if (genres.isPending || albums.isPending || tracks.isPending) return <ListSkeleton kind="grid" />;
  if (genres.isError) return <ErrorState error={genres.error} onRetry={() => void genres.refetch()} />;
  if (albums.isError) return <ErrorState error={albums.error} onRetry={() => void albums.refetch()} />;
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
  return <GenreContents genre={genre} albums={albums.data} tracks={tracks.data} looseTracks={looseTracks} />;
}
