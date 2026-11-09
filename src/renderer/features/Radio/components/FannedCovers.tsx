import { AlbumArt } from '@/components/music/AlbumArt';

// Half a size-20 cover, not a translate: a sleeve lifts on hover by setting translate, and covers here sit still.
const MIDDLE = 'left-[calc(50%-var(--spacing)*10)]';
// Fanned like a hand of records, the first cover in front, laid out for however many there are.
const COVER_PLACES: Record<number, readonly string[]> = {
  1: [MIDDLE],
  2: ['left-2 z-10 -rotate-3', 'right-2 rotate-3'],
  3: [`${MIDDLE} z-10`, 'left-0 -rotate-6', 'right-0 rotate-6'],
};

type Props = {
  /** Up to three, the first in front. */
  covers: readonly string[];
  /** What a cover that won't load says. */
  title: string;
};

/** The top of a Tune it tile. */
export function FannedCovers({ covers, title }: Props) {
  const places = COVER_PLACES[covers.length] ?? [];
  return (
    <span aria-hidden className="relative block h-24 w-full">
      {covers.map((hash, index) => (
        <AlbumArt
          key={hash}
          hash={hash}
          title={title}
          className={`absolute top-2 size-20 shadow-sleeve ${places[index] ?? 'hidden'}`}
        />
      ))}
    </span>
  );
}
