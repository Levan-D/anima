import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type { Track } from '@shared/domain';
import { DetailHeader } from '@/components/music/DetailHeader';
import type { MusicSection } from '@/components/music/listItems';
import { ListSkeleton } from '@/components/music/ListSkeleton';
import { MusicList } from '@/components/music/MusicList';
import { PlayAllButton } from '@/components/music/PlayAllButton';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { formatPlural } from '@/lib/format';
import { similarQuery } from '@/lib/libraryQueries';
import { currentPlace, goBack, placeKey, useNavigation } from '@/lib/navigation';
import { playTracks } from '@/lib/playerActions';
import type { SimilarSource } from '@/lib/queryKeys';
import { openSettings } from '@/lib/pages';

type ContentsProps = {
  title: string;
  memoryKey: string;
  tracks: Track[];
};

function SimilarContents({ title, memoryKey, tracks }: ContentsProps) {
  const sections = useMemo((): MusicSection[] => [{ kind: 'tracks', tracks, numbered: false }], [tracks]);
  const play = useCallback((track: Track) => playTracks(tracks, track), [tracks]);

  return (
    <MusicList
      label={title}
      sections={sections}
      memoryKey={memoryKey}
      onPlayTrack={play}
      header={
        <DetailHeader
          title={title}
          meta={formatPlural(tracks.length, 'track')}
          action={<PlayAllButton tracks={tracks} />}
        />
      }
    />
  );
}

type ViewProps = {
  source: SimilarSource;
  name: string;
  memoryKey: string;
};

function SimilarView({ source, name, memoryKey }: ViewProps) {
  const list = useQuery(similarQuery(source));

  if (list.isPending) return <ListSkeleton kind="rows" />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  if (!list.data.hasSignals) {
    return (
      <EmptyState
        title="Nothing to compare with yet"
        description="Update fingerprints or listener data in Settings, under Data"
        action={<Button onClick={() => openSettings('data')}>Open Data</Button>}
      />
    );
  }
  if (list.data.tracks.length === 0) {
    return (
      <EmptyState
        title={`Nothing close to ${name}`}
        description="Updating fingerprints or listener data may find more"
        action={<Button onClick={goBack}>Back</Button>}
      />
    );
  }
  return <SimilarContents title={`More like ${name}`} memoryKey={memoryKey} tracks={list.data.tracks} />;
}

/** A list of what the engine picks, like any other: it plays, and it has the usual menus. */
export function MoreLikeThis() {
  const place = useNavigation(currentPlace);
  if (place.kind !== 'similar') return null;
  return <SimilarView source={place.source} name={place.name} memoryKey={placeKey(place)} />;
}
