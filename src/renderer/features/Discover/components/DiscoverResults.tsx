import { memo, useDeferredValue, useMemo } from 'react';
import type { DiscoverArtist, DiscoverList } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Carousel } from '@/components/ui/Carousel';
import { EmptyState } from '@/components/ui/EmptyState';
import { Text } from '@/components/ui/Text';
import { useIsSettling } from '@/hooks/useIsSettling';
import { formatPlural } from '@/lib/format';
import {
  clearSelectedGenres,
  setDiscoverQuery,
  useDiscoverQuery,
  useMainGenres,
  useSubGenres,
} from '@/features/Discover/discoverFilter';
import { matching, wantedGenres } from '@/features/Discover/utils/suggestions';
import { SuggestionCard } from './SuggestionCard';
import { SuggestionList } from './SuggestionList';

const CARDS = 12;
const INFERRED = 'Genres are inferred from who recommends it';

type FilteredProps = {
  list: DiscoverList;
  mains: readonly string[];
  subs: readonly string[];
  query: string;
  onOpen: (artist: DiscoverArtist) => void;
};

const Filtered = memo(function Filtered({ list, mains, subs, query, onOpen }: FilteredProps) {
  const isFiltered = mains.length > 0;
  const selected = useMemo(() => wantedGenres(list.genres, mains, subs), [list.genres, mains, subs]);
  const matches = useMemo(() => matching(list.artists, selected, query), [list.artists, selected, query]);
  const cards = isFiltered ? matches.slice(0, CARDS) : [];
  const rows = useMemo(() => (isFiltered ? matches.slice(CARDS) : matches), [isFiltered, matches]);
  const resetKey = [...selected, query].join('\n');

  if (matches.length === 0) {
    return (
      <EmptyState
        title="No suggestions match"
        description="Try other words, or clear the filters to see everything"
        action={
          <Button
            onClick={() => {
              clearSelectedGenres();
              setDiscoverQuery('');
            }}
          >
            Clear
          </Button>
        }
        className="min-h-0 flex-1"
      />
    );
  }

  const header = (
    <>
      <Text as="p" variant="meta" color="muted" tabular className="px-gutter pt-1 pb-2">
        {`${isFiltered ? '' : "Music you might like that isn't in your library · "}${formatPlural(matches.length, 'artist')} · ${INFERRED}`}
      </Text>
      {isFiltered ? (
        // Keyed, so a new filter starts from the first card.
        <Carousel key={resetKey} label="Top suggestions">
          {cards.map((artist) => (
            <SuggestionCard key={artist.key} artist={artist} onOpen={onOpen} />
          ))}
        </Carousel>
      ) : null}
      {rows.length > 0 && isFiltered ? (
        <Text as="h2" variant="label" color="muted" className="block px-gutter pt-section pb-2">
          More like these
        </Text>
      ) : null}
    </>
  );

  return (
    <SuggestionList
      label="Music you might like"
      artists={rows}
      compact={isFiltered}
      resetKey={resetKey}
      header={header}
      onOpen={onOpen}
    />
  );
});

type Props = {
  list: DiscoverList;
  onOpen: (artist: DiscoverArtist) => void;
};

/** Behind the input and the pills, so a keystroke or a press shows at once and the list follows when it can. */
export function DiscoverResults({ list, onOpen }: Props) {
  const liveMains = useMainGenres();
  const liveSubs = useSubGenres();
  const liveQuery = useDiscoverQuery();
  const mains = useDeferredValue(liveMains);
  const subs = useDeferredValue(liveSubs);
  const query = useDeferredValue(liveQuery);
  const isSettling = useIsSettling([...liveMains, ...liveSubs, liveQuery].join('\n'));

  // One layer, around the list, for as long as this takes. The rows stay plain.
  return (
    <div data-settling={isSettling || undefined} className="settles flex min-h-0 flex-1 flex-col">
      <Filtered list={list} mains={mains} subs={subs} query={query} onOpen={onOpen} />
    </div>
  );
}
