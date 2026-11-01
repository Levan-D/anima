import { memo } from 'react';
import type { AlbumSummary } from '@shared/domain';
import { AlbumArt } from '@/components/music/AlbumArt';
import { AlbumCardText } from '@/components/music/AlbumCardText';
import { VinylDisc } from '@/components/music/VinylDisc';
import { Button } from '@/components/ui/Button';
import { useHoverPresence } from '@/hooks/useHoverPresence';
import { joinParts } from '@/lib/format';

type Props = {
  album: AlbumSummary;
  /** Leaves the artist out, when the whole list is one artist's. */
  hideArtist?: boolean;
  onOpen: (albumId: number) => void;
};

export const AlbumCard = memo(function AlbumCard({ album, hideArtist = false, onOpen }: Props) {
  const { isPresent, triggerProps } = useHoverPresence();

  return (
    <Button
      variant="card"
      size="card"
      tabIndex={-1}
      data-testid="album-card"
      onClick={() => onOpen(album.id)}
      className="hover:z-10 focus-visible:z-10"
      {...triggerProps}
    >
      <span className="relative block w-full">
        {isPresent ? <VinylDisc hash={album.artHash} /> : null}
        <AlbumArt hash={album.artHash} title={album.title} surface="sleeve" className="w-full" />
      </span>
      <AlbumCardText title={album.title} subtitle={joinParts(hideArtist ? null : album.artist, album.year)} />
    </Button>
  );
});
