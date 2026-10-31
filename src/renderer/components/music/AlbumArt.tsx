import { memo, useState } from 'react';
import { artUrl, type ArtSize } from '@shared/domain';
import { ArtSleeve } from '@/components/music/ArtSleeve';
import { cn } from '@/lib/cn';

type Props = {
  hash: string | null;
  /** Sets the sleeve when there's no image, so it says what it's for. */
  title: string;
  /** `full` for art big enough to show the thumbnail's limits. The thumbnail still shows until it has loaded. */
  size?: ArtSize;
  className?: string;
};

/** A thumbnail, over a neutral tone that shows until it arrives. Never a broken image. */
export const AlbumArt = memo(function AlbumArt({ hash, title, size = 'thumb', className }: Props) {
  const [failedHash, setFailedHash] = useState<string | null>(null);
  const [failedFullHash, setFailedFullHash] = useState<string | null>(null);

  return (
    <span className={cn('relative block aspect-square overflow-hidden rounded-sm bg-surface-hover', className)}>
      {hash !== null && hash !== failedHash ? (
        <img
          key={hash}
          loading="lazy"
          decoding="async"
          draggable={false}
          src={artUrl(hash, 'thumb')}
          alt=""
          onError={() => setFailedHash(hash)}
          className="block size-full object-cover"
        />
      ) : (
        <ArtSleeve title={title} />
      )}
      {size === 'full' && hash !== null && hash !== failedHash && hash !== failedFullHash ? (
        <img
          key={`${hash}-full`}
          decoding="async"
          draggable={false}
          src={artUrl(hash, 'full')}
          alt=""
          onError={() => setFailedFullHash(hash)}
          className="absolute inset-0 block size-full object-cover"
        />
      ) : null}
    </span>
  );
});
