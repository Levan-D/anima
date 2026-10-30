import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { Track } from '@shared/domain';
import type { MusicSection } from '@/components/music/listItems';
import { ListSkeleton } from '@/components/music/ListSkeleton';
import { MusicList } from '@/components/music/MusicList';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { DetailHeader } from '@/features/Library/components/DetailHeader';
import { formatPlural } from '@/lib/format';
import { tracksQuery } from '@/lib/libraryQueries';
import { goBack, placeKey } from '@/lib/navigation';

const MISSING = { kind: 'missing' } as const;

type ContentsProps = {
  tracks: Track[];
};

function MissingContents({ tracks }: ContentsProps) {
  const sections = useMemo((): MusicSection[] => [{ kind: 'tracks', tracks, numbered: false }], [tracks]);

  return (
    <MusicList
      label="Missing tracks"
      sections={sections}
      memoryKey={placeKey(MISSING)}
      header={
        <DetailHeader title="Missing tracks" meta={`${formatPlural(tracks.length, 'track')} not on this device`} />
      }
    />
  );
}

export function MissingView() {
  const tracks = useQuery(tracksQuery(MISSING));

  if (tracks.isPending) return <ListSkeleton kind="rows" />;
  if (tracks.isError) return <ErrorState error={tracks.error} onRetry={() => void tracks.refetch()} />;
  if (tracks.data.length === 0) {
    return (
      <EmptyState
        title="Nothing is missing"
        description="Every track in the library is on this device"
        action={<Button onClick={goBack}>Back</Button>}
      />
    );
  }
  return <MissingContents tracks={tracks.data} />;
}
