import { memo } from 'react';
import type { AlbumSummary } from '@shared/domain';
import { AlbumArt } from '@/components/music/AlbumArt';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { joinParts } from '@/lib/format';

type Props = {
  album: AlbumSummary;
  onOpen: (albumId: number) => void;
};

export const AlbumRow = memo(function AlbumRow({ album, onOpen }: Props) {
  return (
    <Button variant="row" size="row" tabIndex={-1} data-testid="list-row" onClick={() => onOpen(album.id)}>
      <AlbumArt hash={album.artHash} title={album.title} className="size-11 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col">
        <Text truncate>{album.title}</Text>
        <Text variant="meta" color="muted" truncate>
          {joinParts(album.artist, album.year)}
        </Text>
      </span>
    </Button>
  );
});
