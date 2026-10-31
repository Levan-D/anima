import { memo } from 'react';
import type { PlaylistSummary } from '@shared/domain';
import { AlbumArt } from '@/components/music/AlbumArt';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { formatPlural, formatSpan, joinParts } from '@/lib/format';

type Props = {
  playlist: PlaylistSummary;
  onOpen: (playlistId: number) => void;
};

export const PlaylistRow = memo(function PlaylistRow({ playlist, onOpen }: Props) {
  const { id, name, trackCount, missingCount, durationMs, artHash } = playlist;
  return (
    <Button variant="row" size="row" tabIndex={-1} data-testid="list-row" onClick={() => onOpen(id)}>
      <AlbumArt hash={artHash} title={name} className="size-11 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col">
        <Text truncate>{name}</Text>
        <Text variant="meta" color="muted" tabular truncate>
          {joinParts(
            formatPlural(trackCount, 'track'),
            durationMs > 0 ? formatSpan(durationMs) : null,
            missingCount > 0 ? `${missingCount} not on this device` : null,
          )}
        </Text>
      </span>
    </Button>
  );
});
