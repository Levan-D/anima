import type { DiscoverRecommender } from '@shared/domain';
import { AlbumArt } from '@/components/music/AlbumArt';
import { cn } from '@/lib/cn';
import { coversOf } from '../utils/suggestions';

type Kind = 'row' | 'compact' | 'fan';

const BOX: Record<Kind, string> = {
  row: 'h-18 w-32',
  compact: 'h-10 w-18',
  fan: 'aspect-square w-full',
};

// Front to back, and by how many there are in the fan, so one or two still fill the square.
const COVERS: Record<Kind, readonly string[]> = {
  row: ['left-0 size-18', 'left-7 size-18 rotate-2', 'left-14 size-18 -rotate-2'],
  compact: ['left-0 size-10', 'left-4 size-10 rotate-2', 'left-8 size-10 -rotate-2'],
  fan: [],
};

const FAN = 'transition-transform duration-(--dur-showcase) ease-standard';
const FAN_COVERS: readonly (readonly string[])[] = [
  ['bottom-[4%] left-[10%] w-[80%] group-hover/card:-translate-y-[8%] group-hover/card:scale-110'],
  [
    'right-0 bottom-0 w-[72%] rotate-3 group-hover/card:translate-x-[10%] group-hover/card:-translate-y-[4%] group-hover/card:scale-105 group-hover/card:rotate-6',
    'top-0 left-0 w-[72%] -rotate-3 group-hover/card:-translate-x-[10%] group-hover/card:-translate-y-[4%] group-hover/card:scale-105 group-hover/card:-rotate-6',
  ],
  [
    'bottom-0 left-[14%] w-[72%] group-hover/card:-translate-y-[10%] group-hover/card:scale-110',
    'top-[6%] right-0 w-[60%] rotate-7 group-hover/card:translate-x-[22%] group-hover/card:-translate-y-[4%] group-hover/card:rotate-12',
    'top-[6%] left-0 w-[60%] -rotate-7 group-hover/card:-translate-x-[22%] group-hover/card:-translate-y-[4%] group-hover/card:-rotate-12',
  ],
];

type Props = {
  recommenders: readonly DiscoverRecommender[];
  kind: Kind;
  className?: string;
};

/**
 * The sleeves of who recommends it, closest in front: it has no art of its own to show, and these are why it's here.
 * In a list they're plain boxes. A sleeve's lift promotes it and everything over it to layers of their own, and a big
 * blurred shadow under a rotation is the slowest thing to raster, which a screen of rows can't afford.
 */
export function ArtStack({ recommenders, kind, className }: Props) {
  const covers = coversOf(recommenders);
  const isFan = kind === 'fan';
  const classes = isFan ? (FAN_COVERS[covers.length - 1] ?? []) : COVERS[kind];

  return (
    <span aria-hidden className={cn('relative block shrink-0', BOX[kind], className)}>
      {covers
        .map(({ name, artHash }, index) => (
          <AlbumArt
            key={name}
            hash={artHash}
            title={name}
            size={isFan && index === 0 ? 'full' : 'thumb'}
            surface={isFan ? 'sleeve' : 'row'}
            className={cn('absolute', isFan && cn('shadow-sleeve-lifted', FAN), classes[index])}
          />
        ))
        .toReversed()}
    </span>
  );
}
