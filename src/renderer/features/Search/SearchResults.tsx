import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useDeferredValue, useMemo } from 'react';
import type { SearchResults as Results, Track } from '@shared/domain';
import type { MusicSection } from '@/components/music/listItems';
import { ListSkeleton } from '@/components/music/ListSkeleton';
import { MusicList } from '@/components/music/MusicList';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { searchQuery, useIsScanning } from '@/lib/libraryQueries';
import { clearSearch, openAlbum, openArtist, SEARCH_LIST, useNavigation } from '@/lib/navigation';
import { playTracks } from '@/lib/playerActions';

function heading(what: string, count: number, isCut: boolean): string {
  return isCut ? `First ${count} ${what.toLowerCase()}` : what;
}

function resultSections({ artists, albums, tracks, more }: Results): MusicSection[] {
  return [
    ...(artists.length > 0
      ? ([
          { kind: 'label', text: heading('Artists', artists.length, more.artists) },
          { kind: 'artists', artists },
        ] as const)
      : []),
    ...(albums.length > 0
      ? ([
          { kind: 'label', text: heading('Albums', albums.length, more.albums) },
          { kind: 'albumRows', albums },
        ] as const)
      : []),
    ...(tracks.length > 0
      ? ([
          { kind: 'label', text: heading('Tracks', tracks.length, more.tracks) },
          { kind: 'tracks', tracks, numbered: false },
        ] as const)
      : []),
  ];
}

export function SearchResults() {
  const query = useNavigation((state) => state.query.trim());
  const deferredQuery = useDeferredValue(query);
  const results = useQuery({ ...searchQuery(deferredQuery), placeholderData: keepPreviousData });
  const isScanning = useIsScanning();

  const sections = useMemo(() => (results.data ? resultSections(results.data) : []), [results.data]);
  const tracks = results.data?.tracks;
  const play = useCallback((track: Track) => playTracks(tracks ?? [], track), [tracks]);

  if (results.isPending) return <ListSkeleton kind="rows" />;
  if (results.isError) return <ErrorState error={results.error} onRetry={() => void results.refetch()} />;
  if (sections.length === 0) {
    return (
      <EmptyState
        title={isScanning ? `Nothing yet for “${deferredQuery}”` : `Nothing matches “${deferredQuery}”`}
        description={isScanning ? 'Still reading your music' : 'Check the spelling, or try fewer letters'}
        action={<Button onClick={clearSearch}>Clear search</Button>}
      />
    );
  }
  return (
    <MusicList
      label="Search results"
      sections={sections}
      memoryKey={SEARCH_LIST}
      resetKey={deferredQuery}
      onPlayTrack={play}
      onOpenAlbum={openAlbum}
      onOpenArtist={openArtist}
    />
  );
}
