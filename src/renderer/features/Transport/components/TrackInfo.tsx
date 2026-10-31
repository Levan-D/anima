import { Text } from '@/components/ui/Text';
import { joinParts } from '@/lib/format';
import { usePlayer } from '@/lib/playerStore';

/** Takes the same room with nothing playing, so the controls don't move when something starts. */
export function TrackInfo() {
  const title = usePlayer((state) => state.current?.title ?? '');
  const artist = usePlayer((state) => state.current?.artist ?? null);
  const album = usePlayer((state) => state.current?.album ?? null);
  const details = joinParts(artist, album);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <Text as="h2" variant="nowPlaying" truncate title={title} data-testid="now-playing-title" className="min-h-lh">
        {title}
      </Text>
      <Text as="p" color="muted" truncate title={details} data-testid="now-playing-details" className="min-h-lh">
        {details}
      </Text>
    </div>
  );
}
