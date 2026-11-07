import type { ReactNode } from 'react';
import { AlbumArt } from '@/components/music/AlbumArt';
import { Text } from '@/components/ui/Text';

type Props = {
  title: string;
  /** An album gets its sleeve beside the words. Everything else is just the words, set bigger. */
  art?: { hash: string | null };
  /** Art of its own in the same place, such as a playlist's. */
  cover?: ReactNode;
  /** What's under the title, such as a link to the artist. */
  children?: ReactNode;
  /** The small print: counts, years and lengths. */
  meta: string;
  /** What to do with all of this, such as playing it. */
  action?: ReactNode;
};

// Held to a share of the height too, so a short window still shows rows under it. A narrow column stacks the words under it.
const ART_SLOT = 'w-[min(38cqi,30vh)] shrink-0 self-start';

/** The top of a drilled-in list. It scrolls with the rows, and takes whatever height its title needs. */
export function DetailHeader({ title, art, cover, children, meta, action }: Props) {
  const hasArt = art !== undefined || cover !== undefined;
  return (
    <header className="flex gap-section px-gutter pt-gap pb-section @max-md/column:flex-col">
      {art ? <AlbumArt surface="sleeve" hash={art.hash} title={title} size="full" className={ART_SLOT} /> : null}
      {cover === undefined ? null : <div className={ART_SLOT}>{cover}</div>}
      <div className="flex min-w-0 flex-1 flex-col gap-1 self-start">
        <Text as="h1" variant={hasArt ? 'title' : 'heading'} className="wrap-anywhere select-text">
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
