import { memo, useState, type CSSProperties } from 'react';
import { artUrl, type ArtSize } from '@shared/domain';
import { Text } from '@/components/ui/Text';
import { titleHue } from '@/lib/artFallback';
import { cn } from '@/lib/cn';

type Props = {
  hash: string | null;
  /** Sets the sleeve when there's no image, so it says what it's for. */
  title: string;
  /** `full` for art big enough to show the thumbnail's limits. The thumbnail still shows until it has loaded. */
  size?: ArtSize;
  className?: string;
};

type FallbackProps = {
  title: string;
};

function ArtFallback({ title }: FallbackProps) {
  const sleeve = { '--art-hue': titleHue(title) } as CSSProperties;

  return (
    <span aria-hidden style={sleeve} className="@container absolute inset-0 flex items-end art-fallback">
      {/* Too small a sleeve for words just stays a color. */}
      <span className="hidden min-w-0 p-[7cqi] @sleeve:block">
        <Text variant="cover" className="line-clamp-4">
          {title}
        </Text>
      </span>
    </span>
  );
}

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
        <ArtFallback title={title} />
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
