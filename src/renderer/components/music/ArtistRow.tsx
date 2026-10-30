import { memo } from 'react';
import type { ArtistSummary } from '@shared/domain';
import { AlbumArt } from '@/components/music/AlbumArt';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { formatPlural, joinParts } from '@/lib/format';

type Props = {
  artist: ArtistSummary;
  onOpen: (artistId: number) => void;
};

export const ArtistRow = memo(function ArtistRow({ artist, onOpen }: Props) {
  const albums = artist.albumCount > 0 ? formatPlural(artist.albumCount, 'album') : null;

  return (
    <Button variant="row" size="row" tabIndex={-1} data-testid="list-row" onClick={() => onOpen(artist.id)}>
      <AlbumArt hash={artist.artHash} title={artist.name} className="size-11 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col">
        <Text truncate>{artist.name}</Text>
        <Text variant="meta" color="muted" truncate>
          {joinParts(albums, formatPlural(artist.trackCount, 'track'))}
        </Text>
      </span>
    </Button>
  );
});
