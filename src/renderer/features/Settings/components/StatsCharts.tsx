import type { LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { StatEntry, StatsSummary } from '@shared/domain';
import { AlbumArt } from '@/components/music/AlbumArt';
import { Text } from '@/components/ui/Text';
import { formatCount, formatPlural, formatSpan, joinParts } from '@/lib/format';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthName(month: string): string {
  return MONTH_NAMES[Number(month.slice(5)) - 1] ?? month;
}

function share(value: number, of: number): CSSProperties {
  return { '--share': `${of === 0 ? 0 : (value / of) * 100}%` } as CSSProperties;
}

export const TILE_LOOKS = {
  accent: 'bg-accent text-on-accent',
  complement: 'bg-accent-complement text-on-accent-complement',
  triad: 'bg-accent-triad-a/20 text-text',
} as const;

type TileProps = {
  icon: LucideIcon;
  value: string;
  label: string;
  look: keyof typeof TILE_LOOKS;
};

/** A headline number, in one of the colors that come from the album art. */
export function Tile({ icon: Icon, value, label, look }: TileProps) {
  return (
    <div className={`flex min-w-0 flex-[1_1_12em] items-center gap-gap rounded-lg p-gutter ${TILE_LOOKS[look]}`}>
      <Icon aria-hidden className="size-8 shrink-0 opacity-80" />
      <div className="flex min-w-0 flex-col">
        <Text variant="title" color="inherit" tabular truncate>
          {value}
        </Text>
        <Text variant="meta" color="inherit" className="opacity-80">
          {label}
        </Text>
      </div>
    </div>
  );
}

export function NumberOne({ entry }: { entry: StatEntry }) {
  return (
    <div className="flex items-center gap-section rounded-lg bg-accent/10 p-gutter">
      <AlbumArt hash={entry.artHash} title={entry.name} surface="sleeve" className="size-32 shrink-0" />
      <div className="flex min-w-0 flex-col gap-1">
        <Text variant="meta" color="accent">
          Your number one artist
        </Text>
        <Text variant="heading" truncate>
          {entry.name}
        </Text>
        <Text color="muted">{joinParts(formatPlural(entry.plays, 'play'), formatSpan(entry.listenedMs))}</Text>
      </div>
    </div>
  );
}

export function Months({ months }: { months: StatsSummary['listenedByMonth'] }) {
  const longest = Math.max(0, ...months.map(({ listenedMs }) => listenedMs));

  return (
    <ol className="flex h-48 items-stretch gap-1">
      {months.map(({ month, listenedMs }) => {
        const isBiggest = listenedMs === longest && longest > 0;
        return (
          <li
            key={month}
            title={`${month}: ${formatSpan(listenedMs)}`}
            className="flex max-w-16 min-w-0 flex-1 flex-col items-center gap-1"
          >
            <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-end gap-1">
              {isBiggest ? (
                <Text variant="micro" color="accent" className="whitespace-nowrap">
                  {formatSpan(listenedMs)}
                </Text>
              ) : null}
              <div
                data-testid="month-bar"
                className="h-(--share) w-full rounded-t-md bg-linear-to-t from-accent-complement to-accent"
                style={share(listenedMs, longest)}
              />
            </div>
            <Text variant="meta" color={isBiggest ? 'accent' : 'muted'}>
              {monthName(month)}
            </Text>
          </li>
        );
      })}
    </ol>
  );
}

/** Ranked, with a bar behind each for how its plays compare with the top one's. */
export function TopList({ title, entries }: { title: string; entries: StatEntry[] }) {
  if (entries.length === 0) return null;
  const most = Math.max(...entries.map(({ plays }) => plays));

  return (
    <section aria-label={title} className="flex min-w-0 flex-[1_1_18em] flex-col gap-3">
      <Text as="h3" variant="lead">
        {title}
      </Text>
      <ol className="flex flex-col gap-1.5">
        {entries.map((entry, index) => (
          <li key={entry.id} className="relative flex min-w-0 items-center gap-gap rounded-md p-1.5">
            <div
              aria-hidden
              className="absolute inset-y-0 left-0 w-(--share) rounded-md bg-accent/12"
              style={share(entry.plays, most)}
            />
            <Text variant="lead" color="muted" tabular className="relative flex w-6 shrink-0 justify-center">
              {index + 1}
            </Text>
            <AlbumArt hash={entry.artHash} title={entry.name} className="relative size-11 shrink-0" />
            <span className="relative flex min-w-0 flex-1 flex-col">
              <Text truncate>{entry.name}</Text>
              <Text variant="meta" color="muted" truncate>
                {joinParts(entry.subtitle, formatPlural(entry.plays, 'play'), formatSpan(entry.listenedMs))}
              </Text>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** How much of the library is lossless, as a ring. */
export function LibraryMix({ library }: { library: StatsSummary['library'] }) {
  const total = library.lossless + library.lossy;
  const ring = { '--lossless': `${total === 0 ? 0 : (library.lossless / total) * 100}` } as CSSProperties;

  return (
    <div className="flex flex-wrap items-center gap-section">
      <svg viewBox="0 0 36 36" aria-hidden className="size-32 shrink-0 -rotate-90">
        <circle cx="18" cy="18" r="15.9" pathLength={100} className="fill-none stroke-accent-complement stroke-4" />
        <circle
          cx="18"
          cy="18"
          r="15.9"
          pathLength={100}
          style={ring}
          className="fill-none stroke-accent stroke-4 [stroke-dasharray:var(--lossless)_100]"
        />
      </svg>
      <div className="flex min-w-0 flex-[1_1_14em] flex-col gap-2">
        <Text variant="lead">
          {total === 0 ? 'No files yet' : `${Math.round((library.lossless / total) * 100)}% lossless`}
        </Text>
        <Text color="muted">{`${formatCount(library.lossless)} lossless, ${formatCount(library.lossy)} lossy`}</Text>
        <Text color="muted">
          {joinParts(
            formatPlural(library.tracks, 'track'),
            formatPlural(library.albums, 'album'),
            formatPlural(library.artists, 'artist'),
          )}
        </Text>
        <Text color="muted">{`${formatSpan(library.totalDurationMs)} of music`}</Text>
      </div>
    </div>
  );
}
