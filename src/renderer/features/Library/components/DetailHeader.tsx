import type { ReactNode } from 'react';
import { AlbumArt } from '@/components/music/AlbumArt';
import { Text } from '@/components/ui/Text';

type Props = {
  title: string;
  /** An album gets its sleeve beside the words. Everything else is just the words, set bigger. */
  art?: { hash: string | null };
  /** What's under the title, such as a link to the artist. */
  children?: ReactNode;
  /** The small print: counts, years and lengths. */
  meta: string;
  /** What to do with all of this, such as playing it. */
  action?: ReactNode;
};

/** The top of a drilled-in list. It scrolls with the rows, and takes whatever height its title needs. */
export function DetailHeader({ title, art, children, meta, action }: Props) {
  return (
    <header className="flex gap-section px-gutter pt-gap pb-section">
      {art ? <AlbumArt hash={art.hash} title={title} size="full" className="w-[38cqi] shrink-0 self-start" /> : null}
      {/* Sits on the art's bottom edge, until a long title makes it the taller of the two. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1 self-end">
        <Text as="h1" variant={art ? 'title' : 'heading'} className="wrap-anywhere select-text">
          {title}
        </Text>
        {children}
        <Text as="p" variant="meta" color="muted" tabular>
          {meta}
        </Text>
        {action ? <div className="flex pt-2">{action}</div> : null}
      </div>
    </header>
  );
}
