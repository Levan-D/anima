import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useState } from 'react';
import { BLEND_MAX_PARTS, BLEND_MIN_PARTS, type BlendPart, type RadioStartFrom, type Track } from '@shared/domain';
import { AlbumArt } from '@/components/music/AlbumArt';
import { Button } from '@/components/ui/Button';
import { Collapse } from '@/components/ui/Collapse';
import { Pill } from '@/components/ui/Pill';
import { SearchInput } from '@/components/ui/SearchInput';
import { Text } from '@/components/ui/Text';
import { artistsQuery, searchQuery, tracksQuery } from '@/lib/libraryQueries';
import { useSuggested } from '../hooks/useSuggested';
import { SearchResultState } from './SearchResultState';
import { PICK_LIST, PICKS_SHOWN } from './SongSection';

const OF_EACH = PICKS_SHOWN / 2;

const owned = (tracks: Track[]) => tracks.filter(({ isMissing }) => !isMissing);

type Chosen = BlendPart & { name: string; artHash: string | null };

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
  const isSearching = text !== '';
  const results = useQuery({ ...searchQuery(text), enabled: isSearching });
  const artists = useQuery(artistsQuery);
  const tracks = useQuery({ ...tracksQuery({ kind: 'all' }), select: owned });
  const suggestedArtists = useSuggested(artists.data, OF_EACH);
  const suggestedTracks = useSuggested(tracks.data, OF_EACH);
  const shown = isSearching ? [results] : [artists, tracks];
  const failed = shown.find(({ error }) => error !== null);

  const found: Chosen[] = [
    ...(isSearching ? (results.data?.artists ?? []).slice(0, OF_EACH) : suggestedArtists).map(
      ({ id, name, artHash }): Chosen => ({ kind: 'artist', id, name, artHash }),
    ),
    ...(isSearching ? (results.data?.tracks ?? []).slice(0, OF_EACH) : suggestedTracks).map(
      ({ id, title, artist, artHash }): Chosen => ({ kind: 'track', id, name: `${title} · ${artist}`, artHash }),
    ),
  ];
  const offered = found.filter((part) => !chosen.some((other) => isSame(part, other)));

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-gap p-gutter">
      <Text as="h3" variant="meta" color="muted">
        A blend
      </Text>
      <Text as="p" variant="meta" color="muted">
        Starts radio from the sound between what you pick
      </Text>
      <SearchInput
        value={query}
        onValueChange={setQuery}
        label="Search for songs or artists to blend"
        placeholder={isFull ? 'That makes three' : 'Two or three songs or artists'}
      />
      <div className={PICK_LIST}>
        <SearchResultState
          isLoading={shown.some(({ isPending }) => isPending)}
          isEmpty={offered.length === 0}
          emptyWords={isSearching ? 'Nothing to add for that' : 'Nothing to blend yet'}
          error={failed?.error ?? null}
          onRetry={() => void failed?.refetch()}
        >
          {offered.map((part) => (
            <Button
              key={`${part.kind}-${part.id}`}
              variant="row"
              size="row"
              className="h-row"
              disabled={isFull}
              onClick={() => {
                setChosen([...chosen, part]);
                setQuery('');
              }}
            >
              <AlbumArt hash={part.artHash} title={part.name} className="size-8 shrink-0" />
              <Text truncate className="min-w-0 flex-1">
                {part.name}
              </Text>
              <Text variant="meta" color="muted" className="shrink-0">
                {part.kind === 'artist' ? 'Artist' : 'Song'}
              </Text>
            </Button>
          ))}
        </SearchResultState>
      </div>
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
