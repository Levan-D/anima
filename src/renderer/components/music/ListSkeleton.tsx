import { Skeleton } from '@/components/ui/Skeleton';

const ROWS = Array.from({ length: 24 }, (_, index) => index);
const CARDS = Array.from({ length: 16 }, (_, index) => index);

type Props = {
  kind: 'rows' | 'grid';
};

/** Fades in late, so a read that's over in a moment shows nothing at all. */
export function ListSkeleton({ kind }: Props) {
  if (kind === 'rows') {
    return (
      <div aria-hidden className="flex min-h-0 flex-1 animate-appear-late flex-col overflow-hidden pt-gap">
        {ROWS.map((row) => (
          <div key={row} className="flex h-row shrink-0 items-center gap-gap px-gutter">
            <Skeleton className="size-11 shrink-0 rounded-sm" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-3 w-3/5" />
              <Skeleton className="h-2.5 w-2/5" />
            </div>
            <Skeleton className="h-2.5 w-8" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      aria-hidden
      className="flex min-h-0 flex-1 animate-appear-late flex-wrap content-start gap-x-gap gap-y-section overflow-hidden p-gutter pt-gap [&>*]:flex-[1_0_var(--spacing-card)]"
    >
      {CARDS.map((card) => (
        <div key={card} className="flex min-w-0 flex-col gap-1.5">
          <Skeleton className="aspect-square w-full rounded-sm" />
          <Skeleton className="mt-1 h-3 w-3/4" />
          <Skeleton className="h-2.5 w-1/2" />
        </div>
      ))}
    </div>
  );
}
