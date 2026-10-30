import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { ArtistSummary } from '@shared/domain';
import type { MusicSection } from '@/components/music/listItems';
import { ListSkeleton } from '@/components/music/ListSkeleton';
import { MusicList } from '@/components/music/MusicList';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListEmpty } from '@/features/Library/components/ListEmpty';
import { NothingHereActions } from '@/features/Library/components/NothingHereActions';
import { artistsQuery } from '@/lib/libraryQueries';
import { openArtist, placeKey } from '@/lib/navigation';

type ContentsProps = {
  artists: ArtistSummary[];
};

function ArtistsContents({ artists }: ContentsProps) {
  const sections = useMemo((): MusicSection[] => [{ kind: 'artists', artists }], [artists]);

  return (
    <MusicList
      label="Artists"
      sections={sections}
      memoryKey={placeKey({ kind: 'tab', tab: 'artists' })}
      onOpenArtist={openArtist}
    />
  );
}

export function ArtistsView() {
  const artists = useQuery(artistsQuery);

  if (artists.isPending) return <ListSkeleton kind="rows" />;
  if (artists.isError) return <ErrorState error={artists.error} onRetry={() => void artists.refetch()} />;
  if (artists.data.length === 0) {
    return (
      <ListEmpty
        skeleton="rows"
        title="No artists here"
        description="Nothing in the library is on this device right now"
        action={<NothingHereActions />}
      />
    );
  }
  return <ArtistsContents artists={artists.data} />;
}
