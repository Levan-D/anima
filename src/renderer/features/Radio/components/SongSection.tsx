import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { RadioStartFrom, Track } from '@shared/domain';
import { AlbumArt } from '@/components/music/AlbumArt';
import { Button } from '@/components/ui/Button';
import { SearchInput } from '@/components/ui/SearchInput';
import { Text } from '@/components/ui/Text';
import { useSearchText } from '@/hooks/useSearchText';
import { searchQuery, tracksQuery } from '@/lib/libraryQueries';
import { useSuggested } from '@/features/Radio/hooks/useSuggested';
import { SearchResultState } from './SearchResultState';

export const PICKS_SHOWN = 10;
/** As tall as every pick, so the list doesn't change height between suggestions and a search. */
export const PICK_LIST = 'h-[calc(var(--spacing-row)*10)] overflow-y-auto';

const owned = (tracks: Track[]) => tracks.filter(({ isMissing }) => !isMissing);

type Props = {
  onStart: (from: RadioStartFrom) => void;
};

/** Songs picked at random until something's searched for. Picking one starts radio from it. */
export function SongSection({ onStart }: Props) {
  const [query, setQuery] = useState('');
  const text = useSearchText(query);
  const isSearching = text !== '';
  const results = useQuery({ ...searchQuery(text), enabled: isSearching });
  const library = useQuery({ ...tracksQuery({ kind: 'all' }), select: owned });
  const suggested = useSuggested(library.data, PICKS_SHOWN);
  const shown = isSearching ? results : library;
  const tracks = isSearching ? (results.data?.tracks.slice(0, PICKS_SHOWN) ?? []) : suggested;

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-gap p-gutter">
      <Text as="h3" variant="meta" color="muted">
        A song
      </Text>
      <Text as="p" variant="meta" color="muted">
        Starts radio from the one you pick
      </Text>
      <SearchInput value={query} onValueChange={setQuery} label="Search for a song to start from" />
      <div className={PICK_LIST}>
        <SearchResultState
          isLoading={shown.isPending}
          isEmpty={tracks.length === 0}
          emptyWords={isSearching ? 'No songs match. Try fewer words' : 'No songs yet'}
          error={shown.error}
          onRetry={() => void shown.refetch()}
        >
          {tracks.map((track) => (
            <Button
              key={track.id}
              variant="row"
              size="row"
              className="h-row"
              onClick={() => onStart({ kind: 'track', trackId: track.id })}
            >
              <AlbumArt hash={track.artHash} title={track.album ?? track.title} className="size-8 shrink-0" />
              <Text truncate className="min-w-0 flex-1">
                {track.title}
              </Text>
              <Text variant="meta" color="muted" truncate className="max-w-1/2 min-w-0 shrink-0">
                {track.artist}
              </Text>
            </Button>
          ))}
        </SearchResultState>
      </div>
    </section>
  );
}
