import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ThemeId } from '@shared/themes';
import { Button } from '@/components/ui/Button';
import { Collapse } from '@/components/ui/Collapse';
import { ErrorState } from '@/components/ui/ErrorState';
import { SearchInput } from '@/components/ui/SearchInput';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useSearchText } from '@/hooks/useSearchText';
import { searchQuery } from '@/lib/libraryQueries';
import { markTheme, type ThemeTarget } from '@/lib/seasons';

const MOST_OF_EACH = 3;

type Choice = {
  key: string;
  kind: string;
  name: string;
  target: ThemeTarget;
};

type Props = {
  theme: ThemeId;
  themeLabel: string;
};

/** The way to put something in a theme by hand: an artist, an album or a song, found by name. */
export function ThemeAdder({ theme, themeLabel }: Props) {
  const [query, setQuery] = useState('');
  const text = useSearchText(query);
  const results = useQuery({ ...searchQuery(text), enabled: text !== '' });

  const { artists = [], albums = [], tracks = [] } = results.data ?? {};
  const choices: Choice[] = [
    ...artists.slice(0, MOST_OF_EACH).map(({ id, name }): Choice => ({
      key: `artist:${id}`,
      kind: 'Artist',
      name,
      target: { kind: 'artist', artistId: id },
    })),
    ...albums.slice(0, MOST_OF_EACH).map(({ id, title, artist }): Choice => ({
      key: `album:${id}`,
      kind: 'Album',
      name: `${title} · ${artist}`,
      target: { kind: 'album', albumId: id },
    })),
    ...tracks.slice(0, MOST_OF_EACH).map(({ id, title, artist }): Choice => ({
      key: `track:${id}`,
      kind: 'Song',
      name: `${title} · ${artist}`,
      target: { kind: 'tracks', trackIds: [id] },
    })),
  ];

  function add({ name, target }: Choice): void {
    markTheme(target, theme, `${name}: ${themeLabel}`);
    setQuery('');
  }

  return (
    <div className="flex flex-col gap-1">
      <SearchInput
        value={query}
        onValueChange={setQuery}
        label={`Add to ${themeLabel}`}
        placeholder="Add an artist, album or song"
      />
      <Collapse open={text !== ''}>
        {results.isError ? <ErrorState error={results.error} onRetry={() => void results.refetch()} /> : null}
        {results.isPending && text !== '' ? <Skeleton className="h-row w-full" /> : null}
        {results.isSuccess && choices.length === 0 ? (
          <Text as="p" variant="meta" color="muted" className="py-1">
            Nothing by that name. Try fewer words
          </Text>
        ) : null}
        {choices.map((choice) => (
          <Button key={choice.key} variant="row" size="row" className="h-row" onClick={() => add(choice)}>
            <Text truncate className="min-w-0 flex-1">
              {choice.name}
            </Text>
            <Text variant="meta" color="muted" className="shrink-0">
              {choice.kind}
            </Text>
          </Button>
        ))}
      </Collapse>
    </div>
  );
}
