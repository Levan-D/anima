import { ListMusic } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { cn } from '@/lib/cn';
import { usePlayedFrom } from '@/features/Transport/hooks/usePlayedFrom';
import { useFadeOnChange } from '@/hooks/useFadeOnChange';
import { joinParts } from '@/lib/format';
import { openAlbum, openArtist, openPlaylist } from '@/lib/navigation';
import { usePlayer } from '@/lib/playerStore';

type LinkProps = {
  name: string;
  onOpen: () => void;
  isPlaylist?: boolean;
};

function PlaceLink({ name, onOpen, isPlaylist = false }: LinkProps) {
  return (
    <Button variant="link" size="bare" onClick={onOpen} className={isPlaylist ? '[&_svg]:size-4 [&>span]:gap-1' : ''}>
      {isPlaylist ? <ListMusic aria-label="Playlist" /> : null}
      <Text color="inherit" truncate>
        {name}
      </Text>
    </Button>
  );
}

function Dot() {
  return (
    <Text color="muted" className="shrink-0 whitespace-pre">
      {' · '}
    </Text>
  );
}

// A narrow transport steps the title down from its big size.
const TITLE_WHEN_SMALL = '@max-md:text-lead';
/** Takes the same room with nothing playing, so the controls don't move when something starts. */
export function TrackInfo() {
  const title = usePlayer((state) => state.current?.title ?? '');
  const artist = usePlayer((state) => state.current?.artist ?? null);
  const artistId = usePlayer((state) => state.current?.artistId ?? null);
  const album = usePlayer((state) => state.current?.album ?? null);
  const albumId = usePlayer((state) => state.current?.albumId ?? null);
  const playlist = usePlayedFrom();
  const fadesRef = useFadeOnChange<HTMLDivElement>(usePlayer((state) => state.current?.id ?? null));

  return (
    <div ref={fadesRef} className="flex min-w-0 flex-1 flex-col">
      <Text
        as="h2"
        variant="nowPlaying"
        truncate
        title={title}
        data-testid="now-playing-title"
        className={cn('min-h-lh', TITLE_WHEN_SMALL)}
      >
        {title}
      </Text>
      <p
        title={joinParts(playlist?.name ?? null, artist, album)}
        data-testid="now-playing-details"
        className="flex min-h-lh min-w-0"
      >
        {playlist === null ? null : (
          <>
            <PlaceLink name={playlist.name} isPlaylist onOpen={() => openPlaylist(playlist.id)} />
            {artist === null && album === null ? null : <Dot />}
          </>
        )}
        {artist === null || artistId === null ? null : <PlaceLink name={artist} onOpen={() => openArtist(artistId)} />}
        {artist === null || album === null ? null : <Dot />}
        {album === null || albumId === null ? null : <PlaceLink name={album} onOpen={() => openAlbum(albumId)} />}
      </p>
    </div>
  );
}
