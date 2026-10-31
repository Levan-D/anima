import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type { Track } from '@shared/domain';
import type { MusicSection } from '@/components/music/listItems';
import { ListSkeleton } from '@/components/music/ListSkeleton';
import { MusicList } from '@/components/music/MusicList';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListEmpty } from '@/features/Library/components/ListEmpty';
import { NothingHereActions } from '@/features/Library/components/NothingHereActions';
import { tracksQuery } from '@/lib/libraryQueries';
import { placeKey } from '@/lib/navigation';
import { playTracks } from '@/lib/playerActions';

const EVERY_TRACK = { kind: 'all' } as const;

type ContentsProps = {
  tracks: Track[];
};

function TracksContents({ tracks }: ContentsProps) {
  const sections = useMemo((): MusicSection[] => [{ kind: 'tracks', tracks, numbered: false }], [tracks]);
  const play = useCallback((track: Track) => playTracks(tracks, track), [tracks]);

  return (
    <MusicList
      label="Tracks"
      sections={sections}
      memoryKey={placeKey({ kind: 'tab', tab: 'tracks' })}
      onPlayTrack={play}
    />
  );
}

export function TracksView() {
  const tracks = useQuery(tracksQuery(EVERY_TRACK));

  if (tracks.isPending) return <ListSkeleton kind="rows" />;
  if (tracks.isError) return <ErrorState error={tracks.error} onRetry={() => void tracks.refetch()} />;
  if (tracks.data.length === 0) {
    return (
      <ListEmpty
        skeleton="rows"
        title="No tracks here"
        description="Nothing in the library is on this device right now"
        action={<NothingHereActions />}
      />
    );
  }
  return <TracksContents tracks={tracks.data} />;
}
