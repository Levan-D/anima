import { memo } from 'react';
import type { AlbumSummary } from '@shared/domain';
import { AlbumArt } from '@/components/music/AlbumArt';
import { AlbumCardText } from '@/components/music/AlbumCardText';
import { Button } from '@/components/ui/Button';
import { joinParts } from '@/lib/format';

type Props = {
  album: AlbumSummary;
  /** Leaves the artist out, when the whole list is one artist's. */
  hideArtist?: boolean;
  onOpen: (albumId: number) => void;
};

export const AlbumCard = memo(function AlbumCard({ album, hideArtist = false, onOpen }: Props) {
  return (
    <Button
      variant="card"
      size="card"
      tabIndex={-1}
      data-testid="album-card"
      onClick={() => onOpen(album.id)}
      className="hover:z-10 focus-visible:z-10"
    >
      <AlbumArt hash={album.artHash} title={album.title} surface="sleeve" className="w-full" />
      <AlbumCardText title={album.title} subtitle={joinParts(hideArtist ? null : album.artist, album.year)} />
    </Button>
  );
});
