import type { CSSProperties } from 'react';
import { Text } from '@/components/ui/Text';
import { titleHue } from '@/lib/artFallback';

type Props = {
  title: string;
};

/** What stands in for art there is none of: a calm gradient from the title, so an album always gets the same sleeve. */
export function ArtSleeve({ title }: Props) {
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
