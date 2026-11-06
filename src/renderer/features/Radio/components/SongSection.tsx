import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { RadioStartFrom } from '@shared/domain';
import { SearchInput } from '@/components/ui/SearchInput';
import { Text } from '@/components/ui/Text';
import { useSearchText } from '@/hooks/useSearchText';
import { searchQuery, tracksQuery } from '@/lib/libraryQueries';
import { useSuggested } from '@/features/Radio/hooks/useSuggested';
import { PickRow } from './PickRow';
import { SearchResultState } from './SearchResultState';
import { owned, PICK_LIST, PICKS_SHOWN } from '@/features/Radio/utils/picks';

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
            <PickRow
              key={track.id}
              artHash={track.artHash}
              artTitle={track.album ?? track.title}
              name={track.title}
              aside={track.artist}
              onPick={() => onStart({ kind: 'track', trackId: track.id })}
            />
          ))}
        </SearchResultState>
      </div>
    </section>
  );
}
