import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type { AlbumSummary, Track } from '@shared/domain';
import { ListSkeleton } from '@/components/music/ListSkeleton';
import { MusicList } from '@/components/music/MusicList';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Text } from '@/components/ui/Text';
import { DetailHeader } from '@/components/music/DetailHeader';
import { PlayAllButton } from '@/components/music/PlayAllButton';
import { albumSections } from '@/features/Library/utils/albumSections';
import { isNotFound } from '@/lib/api';
import { formatPlural, formatSpan, joinParts } from '@/lib/format';
import { albumQuery, tracksQuery } from '@/lib/libraryQueries';
import { goBack, openArtist, placeKey } from '@/lib/navigation';
import { playTracks } from '@/lib/playerActions';

type ContentsProps = {
  album: AlbumSummary;
  tracks: Track[];
};

function AlbumContents({ album, tracks }: ContentsProps) {
  const sections = useMemo(() => albumSections(tracks), [tracks]);
  const play = useCallback((track: Track) => playTracks(tracks, track), [tracks]);

  return (
    <MusicList
      label={`Tracks on ${album.title}`}
      sections={sections}
      memoryKey={placeKey({ kind: 'album', albumId: album.id })}
      onPlayTrack={play}
      header={
        <DetailHeader
          title={album.title}
          art={{ hash: album.artHash }}
          meta={joinParts(album.year, formatPlural(album.trackCount, 'track'), formatSpan(album.durationMs))}
          action={<PlayAllButton tracks={tracks} />}
        >
          <Button variant="quiet" size="bare" onClick={() => openArtist(album.artistId)} className="-my-1.5 self-start">
            <Text color="inherit" className="wrap-anywhere">
              {album.artist}
            </Text>
          </Button>
        </DetailHeader>
      }
    />
  );
}

type Props = {
  albumId: number;
};

export function AlbumView({ albumId }: Props) {
  const album = useQuery(albumQuery(albumId));
  const tracks = useQuery(tracksQuery({ kind: 'album', albumId }));

  if (album.isPending || tracks.isPending) return <ListSkeleton kind="rows" />;
  // Main calls an album with no tracks left on this device not found, and they're still in the library, marked missing.
  if (isNotFound(album.error) || (tracks.isSuccess && tracks.data.length === 0)) {
    return (
      <EmptyState
        title="Nothing left on this album"
        description="Its tracks aren't on this device any more"
        action={<Button onClick={goBack}>Back</Button>}
      />
    );
  }
  if (album.isError) return <ErrorState error={album.error} onRetry={() => void album.refetch()} />;
  if (tracks.isError) return <ErrorState error={tracks.error} onRetry={() => void tracks.refetch()} />;
  return <AlbumContents album={album.data} tracks={tracks.data} />;
}
