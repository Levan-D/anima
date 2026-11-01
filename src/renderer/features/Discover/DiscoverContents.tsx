import { useMemo, useState } from 'react';
import type { DiscoverArtist, DiscoverList } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Carousel } from '@/components/ui/Carousel';
import { EmptyState } from '@/components/ui/EmptyState';
import { PillGroup } from '@/components/ui/PillGroup';
import { SearchInput } from '@/components/ui/SearchInput';
import { Text } from '@/components/ui/Text';
import { formatPlural } from '@/lib/format';
import { SuggestionCard } from './components/SuggestionCard';
import { SuggestionDetail } from './components/SuggestionDetail';
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
  // Kept once closed, so what's in the modal doesn't vanish while it fades out.
  const [opened, setOpened] = useState<DiscoverArtist | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  function open(artist: DiscoverArtist): void {
    setOpened(artist);
    setIsOpen(true);
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
            <SuggestionCard key={artist.key} artist={artist} onOpen={open} />
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
      <div className="mx-gutter mb-2 flex shrink-0 items-center gap-gap">
        <SearchInput
          value={query}
          onValueChange={setDiscoverQuery}
          label="Search suggestions"
          placeholder="Search suggestions"
          className="w-[min(24em,100%)]"
        />
        {isFiltered ? (
          <Button variant="ghost" size="sm" onClick={clearSelectedGenres}>
            Clear
          </Button>
        ) : null}
      </div>
      {pills.length > 0 ? (
        <PillGroup
          label="Filter by genre"
          items={pills}
          value={selected}
          onValueChange={setSelectedGenres}
          className="mb-2 px-gutter"
        />
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
          onOpen={open}
        />
      )}
      {opened ? <SuggestionDetail artist={opened} open={isOpen} onOpenChange={setIsOpen} /> : null}
    </>
  );
}
