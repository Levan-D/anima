import { useQuery } from '@tanstack/react-query';
import type { CSSProperties, ReactNode } from 'react';
import type { StatEntry, StatsSummary } from '@shared/domain';
import { AlbumArt } from '@/components/music/AlbumArt';
import { Divider } from '@/components/ui/Divider';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ModalSection } from '@/components/ui/ModalSection';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { formatCount, formatDay, formatPlural, formatSpan, joinParts } from '@/lib/format';
import { statsQuery } from '@/lib/libraryQueries';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthName(month: string): string {
  return MONTH_NAMES[Number(month.slice(5)) - 1] ?? month;
}

function StatsSkeleton() {
  return (
    <div aria-hidden className="flex animate-appear-late flex-col gap-section py-section">
      <Skeleton className="h-6 w-2/5" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <Text variant="title" tabular>
        {value}
      </Text>
      <Text variant="meta" color="muted">
        {label}
      </Text>
    </div>
  );
}

/** One of the lists that share a section side by side. */
function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-3">
      <Text as="h3" variant="lead">
        {title}
      </Text>
      {children}
    </section>
  );
}

function TopList({ title, entries }: { title: string; entries: StatEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <Part title={title}>
      <ol className="flex flex-col gap-2">
        {entries.map((entry) => (
          <li key={entry.id} className="flex min-w-0 items-center gap-gap">
            <AlbumArt hash={entry.artHash} title={entry.name} className="size-11 shrink-0" />
            <span className="flex min-w-0 flex-1 flex-col">
              <Text truncate>{entry.name}</Text>
              <Text variant="meta" color="muted" truncate>
                {joinParts(entry.subtitle, formatPlural(entry.plays, 'play'), formatSpan(entry.listenedMs))}
              </Text>
            </span>
          </li>
        ))}
      </ol>
    </Part>
  );
}

function Months({ months }: { months: StatsSummary['listenedByMonth'] }) {
  const longest = Math.max(1, ...months.map(({ listenedMs }) => listenedMs));
  return (
    <ModalSection title="Listening by month">
      <ol className="flex h-40 items-stretch gap-1">
        {months.map(({ month, listenedMs }) => {
          const share = `${(listenedMs / longest) * 100}%`;
          const bar = { '--share': share } as CSSProperties;
          return (
            <li
              key={month}
              title={`${month}: ${formatSpan(listenedMs)}`}
              className="flex max-w-16 min-w-0 flex-1 flex-col items-center gap-1"
            >
              <div className="flex min-h-0 w-full flex-1 flex-col justify-end">
                <div data-testid="month-bar" className="h-(--share) w-full rounded-t-sm bg-accent" style={bar} />
              </div>
              <Text variant="meta" color="muted">
                {monthName(month)}
              </Text>
            </li>
          );
        })}
      </ol>
    </ModalSection>
  );
}

export function StatsTab() {
  const stats = useQuery(statsQuery);

  if (stats.isPending) return <StatsSkeleton />;
  if (stats.isError) return <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />;

  const { totalPlays, totalListenedMs, firstPlayAt, topArtists, topAlbums, topTracks, listenedByMonth, library } =
    stats.data;
  const libraryLine = joinParts(
    formatPlural(library.tracks, 'track'),
    formatPlural(library.albums, 'album'),
    formatPlural(library.artists, 'artist'),
    formatSpan(library.totalDurationMs),
    `${formatCount(library.lossless)} lossless`,
    `${formatCount(library.lossy)} lossy`,
  );

  return (
    <div data-testid="stats" className="content-in flex flex-col">
      {totalPlays === 0 ? (
        <EmptyState
          className="h-auto py-section"
          title="Nothing played yet"
          description="Play something for 30 seconds and it starts counting here"
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-section py-section">
            <Figure value={formatCount(totalPlays)} label={totalPlays === 1 ? 'play' : 'plays'} />
            <Figure value={formatSpan(totalListenedMs)} label="listened" />
            {firstPlayAt === null ? null : <Figure value={formatDay(firstPlayAt)} label="since" />}
          </div>
          <Months months={listenedByMonth} />
          <div className="relative flex flex-wrap gap-section py-section [&>*]:flex-[1_1_18em]">
            <Divider className="absolute inset-x-0 top-0" />
            <TopList title="Top artists" entries={topArtists} />
            <TopList title="Top albums" entries={topAlbums} />
            <TopList title="Top tracks" entries={topTracks} />
          </div>
        </>
      )}
      <ModalSection title="Your library">
        <Text as="p" color="muted">
          {libraryLine}
        </Text>
      </ModalSection>
    </div>
  );
}
