import { useQuery } from '@tanstack/react-query';
import { CalendarHeart, Clock, Play } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ModalSection } from '@/components/ui/ModalSection';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatCount, formatDay, formatSpan } from '@/lib/format';
import { statsQuery } from '@/lib/libraryQueries';
import { LibraryMix, Months, NumberOne, Tile, TopList } from './StatsCharts';

function StatsSkeleton() {
  return (
    <div aria-hidden className="flex animate-appear-late flex-col gap-section py-section">
      <div className="flex gap-gap">
        <Skeleton className="h-20 flex-1 rounded-lg" />
        <Skeleton className="h-20 flex-1 rounded-lg" />
        <Skeleton className="h-20 flex-1 rounded-lg" />
      </div>
      <Skeleton className="h-40 w-full rounded-lg" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

export function StatsTab() {
  const stats = useQuery(statsQuery);

  if (stats.isPending) return <StatsSkeleton />;
  if (stats.isError) return <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />;

  const { totalPlays, totalListenedMs, firstPlayAt, topArtists, topAlbums, topTracks, listenedByMonth, library } =
    stats.data;
  const numberOne = topArtists[0];

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
          <div className="flex flex-wrap gap-gap py-section">
            <Tile
              icon={Play}
              value={formatCount(totalPlays)}
              label={totalPlays === 1 ? 'play' : 'plays'}
              look="accent"
            />
            <Tile icon={Clock} value={formatSpan(totalListenedMs)} label="listened" look="complement" />
            {firstPlayAt === null ? null : (
              <Tile icon={CalendarHeart} value={formatDay(firstPlayAt)} label="counting since" look="triad" />
            )}
          </div>
          {numberOne === undefined ? null : <NumberOne entry={numberOne} />}
          <ModalSection title="Listening by month">
            <Months months={listenedByMonth} />
          </ModalSection>
          <div className="flex flex-wrap gap-section py-section">
            <TopList title="Top artists" entries={topArtists} />
            <TopList title="Top albums" entries={topAlbums} />
            <TopList title="Top tracks" entries={topTracks} />
          </div>
        </>
      )}
      <ModalSection title="Your library">
        <LibraryMix library={library} />
      </ModalSection>
    </div>
  );
}
