import { useMemo } from 'react';
import type { DiscoverList } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Carousel } from '@/components/ui/Carousel';
import { EmptyState } from '@/components/ui/EmptyState';
import { PillGroup } from '@/components/ui/PillGroup';
import { SearchInput } from '@/components/ui/SearchInput';
import { Text } from '@/components/ui/Text';
import { cn } from '@/lib/cn';
import { formatPlural } from '@/lib/format';
import { SuggestionCard } from './components/SuggestionCard';
import { SuggestionList } from './components/SuggestionList';
import {
  clearSelectedGenres,
  setDiscoverQuery,
  setSelectedGenres,
  useDiscoverQuery,
  useSelectedGenres,
} from './discoverFilter';
import { genrePills, matching } from './utils/suggestions';

const CARDS = 12;
const INFERRED = 'Genres are inferred from who recommends it';

type Props = {
  list: DiscoverList;
};

export function DiscoverContents({ list }: Props) {
  const selected = useSelectedGenres();
  const query = useDiscoverQuery();
  const isFiltered = selected.length > 0;
  const pills = useMemo(() => genrePills(list.genres, selected), [list.genres, selected]);
  const matches = useMemo(() => matching(list.artists, selected, query), [list.artists, selected, query]);
  const cards = isFiltered ? matches.slice(0, CARDS) : [];
  const rows = isFiltered ? matches.slice(CARDS) : matches;
  const resetKey = [...selected, query].join('\n');

  const header = (
    <>
      <Text as="p" variant="meta" color="muted" tabular className="px-gutter pt-1 pb-2">
        {`${isFiltered ? '' : "Music you might like that isn't in your library · "}${formatPlural(matches.length, 'artist')} · ${INFERRED}`}
      </Text>
      {isFiltered ? (
        // Keyed, so a new filter starts from the first card.
        <Carousel key={resetKey} label="Top suggestions">
          {cards.map((artist) => (
            <SuggestionCard key={artist.key} artist={artist} />
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
    <>
      <SearchInput
        value={query}
        onValueChange={setDiscoverQuery}
        label="Search suggestions"
        placeholder="Search suggestions"
        className="mx-gutter mb-2 w-[min(24em,100%-var(--spacing-gutter)*2)] shrink-0"
      />
      {pills.length > 0 ? (
        <div className="flex min-w-0 shrink-0 items-start gap-gap px-[calc(var(--spacing-gutter)-var(--spacing)*0.5)] pb-2">
          <PillGroup
            label="Filter by genre"
            items={pills}
            value={selected}
            onValueChange={setSelectedGenres}
            className="flex-1"
          />
          {/* It holds its place while it's away, so turning on a first pill doesn't rewrap them all. */}
          <Button
            variant="ghost"
            size="sm"
            onClick={clearSelectedGenres}
            className={cn('mt-0.5', !isFiltered && 'invisible')}
          >
            Clear
          </Button>
        </div>
      ) : null}
      {matches.length === 0 ? (
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
      ) : (
        <SuggestionList
          label="Music you might like"
          artists={rows}
          compact={isFiltered}
          resetKey={resetKey}
          header={header}
        />
      )}
    </>
  );
}
