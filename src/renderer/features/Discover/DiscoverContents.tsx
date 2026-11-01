import { useCallback, useState } from 'react';
import type { DiscoverArtist, DiscoverList } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Fade } from '@/components/ui/Fade';
import { SearchInput } from '@/components/ui/SearchInput';
import { DiscoverResults } from './components/DiscoverResults';
import { GenrePills } from './components/GenrePills';
import { SuggestionDetail } from './components/SuggestionDetail';
import { clearSelectedGenres, setDiscoverQuery, useDiscoverQuery, useMainGenres } from './discoverFilter';

function DiscoverSearch() {
  const query = useDiscoverQuery();
  const isFiltered = useMainGenres().length > 0;

  return (
    <div className="mx-gutter mb-2 flex shrink-0 items-center gap-gap">
      <SearchInput
        value={query}
        onValueChange={setDiscoverQuery}
        label="Search suggestions"
        placeholder="Search suggestions"
        className="w-[min(24em,100%)]"
      />
      <Fade show={isFiltered}>
        <Button variant="ghost" size="sm" onClick={clearSelectedGenres}>
          Clear
        </Button>
      </Fade>
    </div>
  );
}

type Props = {
  list: DiscoverList;
};

export function DiscoverContents({ list }: Props) {
  // Kept once closed, so what's in the modal doesn't vanish while it fades out.
  const [opened, setOpened] = useState<DiscoverArtist | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback((artist: DiscoverArtist) => {
    setOpened(artist);
    setIsOpen(true);
  }, []);

  return (
    <>
      <DiscoverSearch />
      <GenrePills list={list} />
      <DiscoverResults list={list} onOpen={open} />
      {opened ? <SuggestionDetail artist={opened} open={isOpen} onOpenChange={setIsOpen} /> : null}
    </>
  );
}
