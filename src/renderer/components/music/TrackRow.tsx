import { memo } from 'react';
import type { Track } from '@shared/domain';
import { AlbumArt } from '@/components/music/AlbumArt';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';

type Props = {
  track: Track;
  /** The track number takes the art's place, for a list that's all one album. */
  numbered?: boolean;
  onPlay: (track: Track) => void;
};

export const TrackRow = memo(function TrackRow({ track, numbered = false, onPlay }: Props) {
  // In one album the art and the album are the same on every row, and so is the artist, unless it's a guest.
  const secondLine = numbered && track.artist === track.albumArtist ? null : track.artist;
  // Movements of one work can differ only at the end, and a row with no second line has room to show that.
  const titleWraps = secondLine === null;

  return (
    <Button
      variant="row"
      size="row"
      tabIndex={-1}
      title={track.title}
      data-testid="list-row"
      onClick={() => onPlay(track)}
      className={cn(track.isMissing && 'opacity-50')}
    >
      {numbered ? (
        <span className="w-6 shrink-0 text-right">
          <Text variant="meta" color="muted" tabular>
            {track.trackNumber}
          </Text>
        </span>
      ) : (
        <AlbumArt hash={track.artHash} title={track.album ?? track.title} className="size-11 shrink-0" />
      )}

      <span className="flex min-w-0 flex-5 flex-col">
        <Text dir="auto" truncate={!titleWraps} className={cn(titleWraps && 'line-clamp-2 wrap-anywhere')}>
          {track.title}
        </Text>
        {secondLine === null ? null : (
          <Text variant="meta" color="muted" truncate>
            {secondLine}
            {!numbered && track.album !== null ? <span className="@wide:hidden"> · {track.album}</span> : null}
          </Text>
        )}
      </span>

      {numbered ? null : (
        <>
          <Text variant="meta" color="muted" truncate className="hidden min-w-0 flex-4 @wide:block">
            {track.album}
          </Text>
          <Text variant="meta" color="muted" tabular className="hidden w-11 shrink-0 @wide:block">
            {track.year}
          </Text>
        </>
      )}

      <Text variant="meta" color="muted" tabular className="ml-auto shrink-0">
        {formatDuration(track.durationMs)}
      </Text>
    </Button>
  );
});
