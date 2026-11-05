import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { cn } from '@/lib/cn';
import { useFadeOnChange } from '@/hooks/useFadeOnChange';
import { joinParts } from '@/lib/format';
import { openAlbum, openArtist } from '@/lib/navigation';
import { usePlayer } from '@/lib/playerStore';

type LinkProps = {
  name: string;
  onOpen: () => void;
};

function PlaceLink({ name, onOpen }: LinkProps) {
  return (
    <Button variant="link" size="bare" onClick={onOpen}>
      <Text color="inherit" truncate>
        {name}
      </Text>
    </Button>
  );
}

// With the art hidden for a short window, the title steps down from its big size to fit the packed transport.
const TITLE_WHEN_TINY = 'tiny:text-lead';
/** Takes the same room with nothing playing, so the controls don't move when something starts. */
export function TrackInfo() {
  const title = usePlayer((state) => state.current?.title ?? '');
  const artist = usePlayer((state) => state.current?.artist ?? null);
  const artistId = usePlayer((state) => state.current?.artistId ?? null);
  const album = usePlayer((state) => state.current?.album ?? null);
  const albumId = usePlayer((state) => state.current?.albumId ?? null);
  const fadesRef = useFadeOnChange<HTMLDivElement>(usePlayer((state) => state.current?.id ?? null));

  return (
    <div ref={fadesRef} className="flex min-w-0 flex-1 flex-col">
      <Text
        as="h2"
        variant="nowPlaying"
        truncate
        title={title}
        data-testid="now-playing-title"
        className={cn('min-h-lh', TITLE_WHEN_TINY)}
      >
        {title}
      </Text>
      <p title={joinParts(artist, album)} data-testid="now-playing-details" className="flex min-h-lh min-w-0">
        {artist === null || artistId === null ? null : <PlaceLink name={artist} onOpen={() => openArtist(artistId)} />}
        {artist === null || album === null ? null : (
          <Text color="muted" className="shrink-0 whitespace-pre">
            {' · '}
          </Text>
        )}
        {album === null || albumId === null ? null : <PlaceLink name={album} onOpen={() => openAlbum(albumId)} />}
      </p>
    </div>
  );
}
