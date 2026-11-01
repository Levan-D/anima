import { useQuery } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { AlbumArt } from '@/components/music/AlbumArt';
import { Button } from '@/components/ui/Button';
import { HoverCard } from '@/components/ui/HoverCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { formatDuration, joinParts } from '@/lib/format';
import { tracksQuery } from '@/lib/libraryQueries';
import { openAlbum, openArtist } from '@/lib/navigation';
import { playTracks } from '@/lib/playerActions';

type DetailsProps = {
  trackId: number;
  artistId: number;
  onLeave: () => void;
};

function Details({ trackId, artistId, onLeave }: DetailsProps) {
  const tracks = useQuery(tracksQuery({ kind: 'artist', artistId }));

  if (tracks.isPending) {
    return (
      <div aria-busy className="flex animate-appear-late gap-gap">
        <Skeleton className="size-24 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
    );
  }
  if (tracks.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-gap">
        <Text as="p" color="muted">
          Couldn&apos;t load this track
        </Text>
        <Button variant="outline" size="md" onClick={() => void tracks.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const track = tracks.data.find(({ id }) => id === trackId);
  if (track === undefined) {
    return (
      <Text as="p" color="muted">
        This track isn&apos;t in the library any more
      </Text>
    );
  }

  const { album, albumId } = track;
  return (
    <div className="flex gap-gap">
      <AlbumArt hash={track.artHash} title={album ?? track.title} className="size-24 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
        <Text truncate className="max-w-full min-w-0">
          {track.title}
        </Text>
        <Button
          variant="link"
          size="mark"
          className="max-w-full"
          onClick={() => {
            onLeave();
            openArtist(track.artistId);
          }}
        >
          <Text variant="meta" color="inherit" truncate className="min-w-0">
            {track.artist}
          </Text>
        </Button>
        {album !== null && albumId !== null ? (
          <Button
            variant="link"
            size="mark"
            className="max-w-full"
            onClick={() => {
              onLeave();
              openAlbum(albumId);
            }}
          >
            <Text variant="meta" color="inherit" truncate className="min-w-0">
              {album}
            </Text>
          </Button>
        ) : null}
        <Text variant="meta" color="muted" tabular>
          {joinParts(track.year, formatDuration(track.durationMs))}
        </Text>
        <Button variant="outline" size="sm" className="mt-1" onClick={() => playTracks([track])}>
          <Play aria-hidden />
          Play
        </Button>
      </div>
    </div>
  );
}

type Props = {
  trackId: number;
  artistId: number;
  title: string;
  /** Going to the artist or the album takes the modal away first. */
  onLeave: () => void;
};

/** An owned track named inline, which says more about itself when pointed at, focused or tapped. */
export function OwnedTrackCard({ trackId, artistId, title, onLeave }: Props) {
  return (
    <HoverCard
      label={title}
      className="w-110"
      trigger={
        <Button variant="link" size="mark">
          <Text variant="meta" color="inherit" truncate className="min-w-0">
            {title}
          </Text>
        </Button>
      }
    >
      <Details trackId={trackId} artistId={artistId} onLeave={onLeave} />
    </HoverCard>
  );
}
