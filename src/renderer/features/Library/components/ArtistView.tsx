import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type { AlbumSummary, ArtistSummary, Track } from '@shared/domain';
import type { MusicSection } from '@/components/music/listItems';
import { ListSkeleton } from '@/components/music/ListSkeleton';
import { MusicList } from '@/components/music/MusicList';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { DetailHeader } from '@/features/Library/components/DetailHeader';
import { PlayAllButton } from '@/features/Library/components/PlayAllButton';
import { isNotFound } from '@/lib/api';
import { formatPlural, joinParts } from '@/lib/format';
import { albumsQuery, artistQuery, tracksQuery } from '@/lib/libraryQueries';
import { goBack, openAlbum, placeKey } from '@/lib/navigation';
import { playTracks } from '@/lib/playerActions';

type ContentsProps = {
  artist: ArtistSummary;
  albums: AlbumSummary[];
  tracks: Track[];
};

function ArtistContents({ artist, albums, tracks }: ContentsProps) {
  const sections = useMemo(
    (): MusicSection[] => [
      ...(albums.length > 0 ? [{ kind: 'albums', albums, hideArtist: true } as const] : []),
      { kind: 'label', text: 'Tracks' },
      { kind: 'tracks', tracks, numbered: false },
    ],
    [albums, tracks],
  );
  const play = useCallback((track: Track) => playTracks(tracks, track), [tracks]);

  return (
    <MusicList
      label={`Music by ${artist.name}`}
      sections={sections}
      memoryKey={placeKey({ kind: 'artist', artistId: artist.id })}
      onOpenAlbum={openAlbum}
      onPlayTrack={play}
      header={
        <DetailHeader
          title={artist.name}
          meta={joinParts(
            artist.albumCount > 0 ? formatPlural(artist.albumCount, 'album') : null,
            formatPlural(artist.trackCount, 'track'),
          )}
          action={<PlayAllButton tracks={tracks} />}
        />
      }
    />
  );
}

type Props = {
  artistId: number;
};

export function ArtistView({ artistId }: Props) {
  const artist = useQuery(artistQuery(artistId));
  const albums = useQuery(albumsQuery({ artistId, genreId: null }));
  const tracks = useQuery(tracksQuery({ kind: 'artist', artistId }));

  if (artist.isPending || albums.isPending || tracks.isPending) return <ListSkeleton kind="grid" />;
  // Main calls an artist with no tracks left on this device not found, and they're still in the library, marked missing.
  if (isNotFound(artist.error) || (tracks.isSuccess && tracks.data.length === 0)) {
    return (
      <EmptyState
        title="Nothing left by this artist"
        description="Their tracks aren't on this device any more"
        action={<Button onClick={goBack}>Back</Button>}
      />
    );
  }
  if (artist.isError) return <ErrorState error={artist.error} onRetry={() => void artist.refetch()} />;
  if (albums.isError) return <ErrorState error={albums.error} onRetry={() => void albums.refetch()} />;
  if (tracks.isError) return <ErrorState error={tracks.error} onRetry={() => void tracks.refetch()} />;
  return <ArtistContents artist={artist.data} albums={albums.data} tracks={tracks.data} />;
}
