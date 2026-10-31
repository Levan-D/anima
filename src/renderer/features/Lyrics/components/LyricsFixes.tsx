import { Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { LyricsSearchHit } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Text } from '@/components/ui/Text';
import { formatDuration, joinParts } from '@/lib/format';
import { useChooseLyrics, useClearLyrics, useLoadLyricsFile, useSearchLyrics } from '@/lib/lyricsActions';
import { usePlayer } from '@/lib/playerStore';

const KIND_WORDS: Record<LyricsSearchHit['kind'], string> = {
  synced: 'Synced',
  plain: 'Plain',
  instrumental: 'Instrumental',
};

type FailedProps = {
  message: string;
  onRetry: () => void;
};

function Failed({ message, onRetry }: FailedProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Text as="p" variant="meta" color="muted">
        {message}
      </Text>
      <Button variant="ghost" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

type HitsProps = {
  hits: LyricsSearchHit[];
  choosingId: number | null;
  onChoose: (id: number) => void;
};

function Hits({ hits, choosingId, onChoose }: HitsProps) {
  if (hits.length === 0) {
    return (
      <Text as="p" variant="meta" color="muted">
        Nothing found. Try fewer words
      </Text>
    );
  }
  return (
    <div data-testid="lyrics-hits" className="flex max-h-72 min-h-0 flex-col overflow-y-auto">
      {hits.map(({ id, title, artist, album, durationMs, kind }) => (
        <Button
          key={id}
          variant="row"
          size="bare"
          className="shrink-0 rounded-md px-2 py-1"
          loading={choosingId === id}
          onClick={() => onChoose(id)}
        >
          <span className="flex min-w-0 flex-col">
            <Text truncate>{title}</Text>
            <Text variant="meta" color="muted" truncate>
              {joinParts(artist, album, formatDuration(durationMs), KIND_WORDS[kind])}
            </Text>
          </span>
        </Button>
      ))}
    </div>
  );
}

type Props = {
  trackId: number;
  /** A fix went through, and its lyrics are on the way. */
  onDone: () => void;
};

/** Search, load a file or start over. Available on any track, whatever it has or hasn't got. */
export function LyricsFixes({ trackId, onDone }: Props) {
  const current = usePlayer((state) => state.current);
  const [query, setQuery] = useState(() => (current === null ? '' : `${current.artist} ${current.title}`));
  const search = useSearchLyrics();
  const choose = useChooseLyrics(trackId, onDone);
  const loadFile = useLoadLyricsFile(trackId, onDone);
  const clear = useClearLyrics(trackId, onDone);

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (query.trim() !== '') search.mutate(query.trim());
  }

  return (
    <div data-keeps-lyrics-open className="flex min-h-0 w-full flex-col gap-3 no-drag">
      <form className="flex h-tap gap-2" onSubmit={submit}>
        <Input
          aria-label="Search LRCLIB"
          placeholder="Artist and title"
          maxLength={200}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button type="submit" variant="outline" size="icon" aria-label="Search" loading={search.isPending}>
          <Search aria-hidden />
        </Button>
      </form>

      {search.isError ? <Failed message={search.error.message} onRetry={() => search.mutate(query.trim())} /> : null}
      {search.isSuccess ? (
        <Hits
          hits={search.data}
          choosingId={choose.isPending ? choose.variables : null}
          onChoose={(id) => choose.mutate(id)}
        />
      ) : null}
      {choose.isError ? (
        <Failed message={choose.error.message} onRetry={() => choose.mutate(choose.variables)} />
      ) : null}

      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="outline" size="sm" loading={loadFile.isPending} onClick={() => loadFile.mutate()}>
          Load file
        </Button>
        <Button variant="outline" size="sm" loading={clear.isPending} onClick={() => clear.mutate()}>
          Clear
        </Button>
      </div>
    </div>
  );
}
