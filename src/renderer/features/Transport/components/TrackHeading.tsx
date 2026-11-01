import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { openAlbum, openArtist } from '@/lib/navigation';
import { usePlayer } from '@/lib/playerStore';

/** Title and artist, centered, each going to its page. Takes the same room with nothing playing, so nothing below moves. */
export function TrackHeading() {
  const title = usePlayer((state) => state.current?.title ?? '');
  const albumId = usePlayer((state) => state.current?.albumId ?? null);
  const artist = usePlayer((state) => state.current?.artist ?? null);
  const artistId = usePlayer((state) => state.current?.artistId ?? null);

  const titleText = (
    <Text as="h2" variant="title" truncate title={title} data-testid="now-playing-title" className="min-h-lh">
      {title}
    </Text>
  );

  return (
    <div className="flex w-full min-w-0 flex-col items-center text-center">
      {albumId === null ? (
        titleText
      ) : (
        <Button variant="link" size="bare" className="max-w-full" onClick={() => openAlbum(albumId)}>
          {titleText}
        </Button>
      )}
      <div data-testid="now-playing-details" className="flex min-h-lh max-w-full min-w-0 justify-center">
        {artist === null || artistId === null ? null : (
          <Button variant="link" size="bare" onClick={() => openArtist(artistId)}>
            <Text color="inherit" truncate>
              {artist}
            </Text>
          </Button>
        )}
      </div>
    </div>
  );
}
