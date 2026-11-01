import { useMemo, useState } from 'react';
import type { DiscoverArtist, DiscoverList } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Carousel } from '@/components/ui/Carousel';
import { Divider } from '@/components/ui/Divider';
import { EmptyState } from '@/components/ui/EmptyState';
import { PillGroup } from '@/components/ui/PillGroup';
import { SearchInput } from '@/components/ui/SearchInput';
import { Text } from '@/components/ui/Text';
import { cn } from '@/lib/cn';
import { formatPlural } from '@/lib/format';
import { SuggestionCard } from './components/SuggestionCard';
import { SuggestionDetail } from './components/SuggestionDetail';
import { SuggestionList } from './components/SuggestionList';
import {
  clearSelectedGenres,
  setDiscoverQuery,
  setMainGenres,
  setSubGenres,
  useDiscoverQuery,
  useMainGenres,
  useSubGenres,
} from './discoverFilter';
import { mainGenrePills, matching, subGenrePills, wantedGenres } from './utils/suggestions';

const CARDS = 12;
const INFERRED = 'Genres are inferred from who recommends it';

type Props = {
  list: DiscoverList;
};

export function DiscoverContents({ list }: Props) {
  const mains = useMainGenres();
  const subs = useSubGenres();
  const query = useDiscoverQuery();
  const isFiltered = mains.length > 0;
  const mainPills = useMemo(() => mainGenrePills(list.artists, mains), [list.artists, mains]);
  const subPills = useMemo(() => subGenrePills(list.genres, mains), [list.genres, mains]);
  const selected = useMemo(() => wantedGenres(list.genres, mains, subs), [list.genres, mains, subs]);
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
      {mainPills.length > 0 ? (
        // The full set keeps its place while it's hidden, so picking a genre moves nothing below.
        <div className="relative mb-2 shrink-0">
          <PillGroup
            label="Filter by genre"
            items={mainPills}
            value={mains}
            onValueChange={setMainGenres}
            rows={2}
            className={cn('px-gutter', isFiltered && 'invisible')}
          />
          {isFiltered ? (
            <div className="absolute inset-0 flex items-start gap-1.5 px-gutter">
              <PillGroup
                label="Chosen genre, press to go back"
                items={mainPills.filter(({ value }) => mains.includes(value))}
                value={mains}
                onValueChange={setMainGenres}
                rows={1}
                className="w-auto"
              />
              <Divider orientation="vertical" className="mx-1 self-stretch" />
              <PillGroup
                label="Narrow by sub genre"
                items={subPills}
                value={subs}
                onValueChange={setSubGenres}
                rows={2}
                className="w-auto min-w-0 flex-1"
              />
            </div>
          ) : null}
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
          onOpen={open}
        />
      )}
      {opened ? <SuggestionDetail artist={opened} open={isOpen} onOpenChange={setIsOpen} /> : null}
    </>
  );
}
