import type { CSSProperties } from 'react';
import type { ArtSize, PlaylistCover as Cover } from '@shared/domain';
import { AlbumArt } from '@/components/music/AlbumArt';
import { cn } from '@/lib/cn';

/** A little off true, each its own way, so the strips look stuck together by hand. */
const TILTS = ['-rotate-2', 'rotate-1', '-rotate-1', 'rotate-2'] as const;

type Props = {
  covers: readonly Cover[];
  /** Sets the sleeve when there's no art at all. */
  title: string;
  size?: ArtSize;
  className?: string;
};

/**
 * A playlist's art: one artist's cover when that's all it has, or a strip of each of its biggest artists' covers, as wide
 * as their share of the playlist.
 */
export function PlaylistCover({ covers, title, size = 'thumb', className }: Props) {
  const [only] = covers;
  if (covers.length <= 1) {
    return <AlbumArt hash={only?.artHash ?? null} title={title} size={size} className={cn(className)} />;
  }

  return (
    <span
      className={cn(
        'relative flex aspect-square overflow-hidden rounded-sm bg-surface-hover shadow-sleeve-tiny',
        className,
      )}
    >
      {covers.map(({ artHash, tracks }, index) => (
        <span
          key={artHash}
          style={{ '--share': tracks } as CSSProperties}
          className={cn(
            'relative -mx-[2%] min-w-[14%] shrink-0 grow-(--share) basis-0 scale-y-110 overflow-hidden shadow-sleeve-tiny',
            TILTS[index],
          )}
        >
          <AlbumArt hash={artHash} title={title} size={size} className="absolute inset-0 size-full rounded-none" />
        </span>
      ))}
    </span>
  );
}
