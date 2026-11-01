import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useState } from 'react';
import { BLEND_MAX_PARTS, BLEND_MIN_PARTS, type BlendPart, type RadioStartFrom } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Collapse } from '@/components/ui/Collapse';
import { Pill } from '@/components/ui/Pill';
import { SearchInput } from '@/components/ui/SearchInput';
import { Text } from '@/components/ui/Text';
import { searchQuery } from '@/lib/libraryQueries';
import { SearchResultState } from './SearchResultState';

const RESULTS_OF_EACH = 3;

type Chosen = BlendPart & { name: string };

function isSame(a: BlendPart, b: BlendPart): boolean {
  return a.kind === b.kind && a.id === b.id;
}

type Props = {
  onStart: (from: RadioStartFrom) => void;
};

export function BlendSection({ onStart }: Props) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<readonly Chosen[]>([]);
  const text = query.trim();
  const isFull = chosen.length >= BLEND_MAX_PARTS;
  const isSearching = text !== '' && !isFull;
  const results = useQuery({ ...searchQuery(text), enabled: isSearching });

  const found: Chosen[] = [
    ...(results.data?.artists ?? [])
      .slice(0, RESULTS_OF_EACH)
      .map(({ id, name }): Chosen => ({ kind: 'artist', id, name })),
    ...(results.data?.tracks ?? [])
      .slice(0, RESULTS_OF_EACH)
      .map(({ id, title, artist }): Chosen => ({ kind: 'track', id, name: `${title} · ${artist}` })),
  ];
  const offered = found.filter((part) => !chosen.some((other) => isSame(part, other)));

  return (
    <section className="flex shrink-0 flex-col gap-gap p-gutter">
      <Text as="h3" variant="meta" color="muted">
        A blend
      </Text>
      <SearchInput
        value={query}
        onValueChange={setQuery}
        label="Search for songs or artists to blend"
        placeholder={isFull ? 'That makes three' : 'Two or three songs or artists'}
      />
      <Collapse open={isSearching}>
        <SearchResultState
          isLoading={results.isPending}
          isEmpty={offered.length === 0}
          emptyWords="Nothing to add for that"
          error={results.error}
          onRetry={() => void results.refetch()}
        >
          {offered.map((part) => (
            <Button
              key={`${part.kind}-${part.id}`}
              variant="row"
              size="row"
              className="h-row"
              onClick={() => {
                setChosen([...chosen, part]);
                setQuery('');
              }}
            >
              <Text truncate className="min-w-0 flex-1">
                {part.name}
              </Text>
              <Text variant="meta" color="muted" className="shrink-0">
                {part.kind === 'artist' ? 'Artist' : 'Song'}
              </Text>
            </Button>
          ))}
        </SearchResultState>
      </Collapse>
      <Collapse open={chosen.length > 0}>
        <div className="flex flex-wrap items-center gap-1.5">
          {chosen.map((part) => (
            <Pill
              key={`${part.kind}-${part.id}`}
              aria-label={`Take ${part.name} out of the blend`}
              onClick={() => setChosen(chosen.filter((other) => !isSame(part, other)))}
              className="max-w-full"
            >
              <Text as="span" variant="meta" color="inherit" truncate className="min-w-0">
                {part.name}
              </Text>
              <X aria-hidden className="size-4" />
            </Pill>
          ))}
        </div>
      </Collapse>
      <Button
        className="self-start"
        disabled={chosen.length < BLEND_MIN_PARTS}
        onClick={() => onStart({ kind: 'blend', parts: chosen.map(({ kind, id }) => ({ kind, id })) })}
      >
        Start
      </Button>
    </section>
  );
}
