import { X } from 'lucide-react';
import { memo } from 'react';
import type { Track } from '@shared/domain';
import { AlbumArt } from '@/components/music/AlbumArt';
import { PlayingBars } from '@/components/music/PlayingBars';
import { Button } from '@/components/ui/Button';
import { DragHandle } from '@/components/ui/DragReorder';
import { Text } from '@/components/ui/Text';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { usePlayer } from '@/lib/playerStore';
import { isMousePress, pressMeansPlay } from '@/lib/press';
import { pressRow, useSelection } from '@/lib/selection';

const NOT_HERE = 'Not on this device';

type Props = {
  track: Track;
  /** The track number takes the art's place, for a list that's all one album. */
  numbered?: boolean;
  /** Its place in the queue, for the queue's own list: a track can be in there twice, and only one of them is current. */
  queueIndex?: number | null;
  /** What a drag calls this row, which gets a handle for it. Null when it can't be picked up. */
  dragId?: number | null;
  /** What the selection calls this row. Null when it isn't in a list that has one. */
  selectionKey?: string | null;
  onPlay: (track: Track, queueIndex: number | null) => void;
  /** Gives a row with a `dragId` a button at its end that takes it out of the list. */
  onRemove?: ((dragId: number) => void) | null;
  removeLabel?: string;
};

/** In one album the art and the album are the same on every row, and so is the artist, unless it's a guest. */
function secondLineOf({ isMissing, artist, albumArtist }: Track, numbered: boolean): string | null {
  if (isMissing) return NOT_HERE;
  return numbered && artist === albumArtist ? null : artist;
}

export const TrackRow = memo(function TrackRow({
  track,
  numbered = false,
  queueIndex = null,
  dragId = null,
  selectionKey = null,
  onPlay,
  onRemove = null,
  removeLabel,
}: Props) {
  // One of these for each row on screen, and it only re-renders the row whose answer changes.
  const isCurrent = usePlayer((state) =>
    queueIndex === null ? state.current?.id === track.id : state.queueIndex === queueIndex,
  );
  const isSelected = useSelection((state) => selectionKey !== null && state.keys.has(selectionKey));

  const secondLine = secondLineOf(track, numbered);
  // Movements of one work can differ only at the end, and a row with no second line has room to show that.
  const titleWraps = secondLine === null;
  const showsAlbum = !numbered && !track.isMissing && track.album !== null;
  const canRemove = onRemove !== null && dragId !== null;

  const row = (
    <Button
      variant="row"
      size="row"
      tabIndex={-1}
      title={track.isMissing ? NOT_HERE : track.title}
      data-testid="list-row"
      aria-current={isCurrent || undefined}
      aria-disabled={track.isMissing || undefined}
      aria-pressed={isSelected || undefined}
      data-selected={isSelected || undefined}
      data-drag-id={canRemove ? undefined : (dragId ?? undefined)}
      className={cn('data-selected:bg-surface-active', canRemove && 'pr-0')}
      onClick={(event) => {
        const press = { ctrl: event.ctrlKey, shift: event.shiftKey, isMouse: isMousePress(event) };
        if (selectionKey !== null && pressRow(selectionKey, press)) return;
        if (!track.isMissing && pressMeansPlay(event)) onPlay(track, queueIndex);
      }}
    >
      {dragId === null ? null : <DragHandle />}
      {numbered ? (
        <span className="w-6 shrink-0 text-right">
          {isCurrent ? (
            <PlayingBars />
          ) : (
            <Text variant="meta" color="muted" tabular>
              {track.trackNumber}
            </Text>
          )}
        </span>
      ) : (
        <span className="relative size-11 shrink-0">
          <AlbumArt hash={track.artHash} title={track.album ?? track.title} className="size-full" />
          {isCurrent ? (
            <span className="absolute inset-0 flex items-center justify-center rounded-sm bg-scrim">
              <PlayingBars />
            </span>
          ) : null}
        </span>
      )}

      <span className="flex min-w-0 flex-5 flex-col">
        <Text
          dir="auto"
          color={isCurrent ? 'accent' : 'default'}
          truncate={!titleWraps}
          className={cn(titleWraps && 'line-clamp-2 wrap-anywhere')}
        >
          {track.title}
        </Text>
        {secondLine === null ? null : (
          <Text variant="meta" color="muted" truncate>
            {secondLine}
            {showsAlbum ? <span className="@wide:hidden"> · {track.album}</span> : null}
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
  if (!canRemove) return row;

  // Beside the row and not in it, since a button can't hold a button. A `title` and no Tooltip, which is state on every row.
  return (
    <div data-drag-id={dragId} className="flex h-full items-center">
      <div className="h-full min-w-0 flex-1">{row}</div>
      <Button
        variant="ghost"
        size="icon"
        tabIndex={-1}
        data-row-aside
        aria-label={removeLabel}
        title={removeLabel}
        onClick={() => onRemove(dragId)}
        className="shrink-0"
      >
        <X aria-hidden />
      </Button>
    </div>
  );
});
