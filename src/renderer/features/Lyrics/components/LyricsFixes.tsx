import { Search } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState, type FormEvent, type ReactNode } from 'react';
import type { LyricsSearchHit } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { ConfirmButton } from '@/components/ui/ConfirmButton';
import { Input } from '@/components/ui/Input';
import { Text } from '@/components/ui/Text';
import { formatDuration, joinParts } from '@/lib/format';
import {
  revealLyrics,
  useChooseLyrics,
  useClearLyrics,
  useLoadLyricsFile,
  useSearchLyrics,
} from '@/lib/lyricsActions';
import { motionDuration } from '@/lib/motionTokens';
import { usePlayer } from '@/lib/playerStore';

const KIND_WORDS: Record<LyricsSearchHit['kind'], string> = {
  synced: 'Synced',
  plain: 'Plain',
  instrumental: 'Instrumental',
};

type UnfoldsProps = {
  children: ReactNode;
};

/** The gap is inside it, so it folds away too. Clipped rather than hidden, which leaves room for a focus ring. */
function Unfolds({ children }: UnfoldsProps) {
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: motionDuration('--dur-mid'), ease: [0.2, 0, 0, 1] }}
      className="shrink-0 overflow-clip [overflow-clip-margin:calc(var(--focus-width)*2)]"
    >
      <div className="pt-3">{children}</div>
    </motion.div>
  );
}

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
  asks: boolean;
  onChoose: (id: number) => void;
};

function Hits({ hits, choosingId, asks, onChoose }: HitsProps) {
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
        <ConfirmButton
          key={id}
          fill
          asks={asks}
          variant="row"
          size="bare"
          className="rounded-md px-2 py-1"
          loading={choosingId === id}
          onConfirm={() => onChoose(id)}
        >
          <span className="flex min-w-0 flex-col">
            <Text truncate>{title}</Text>
            <Text variant="meta" color="muted" truncate>
              {joinParts(artist, album, formatDuration(durationMs), KIND_WORDS[kind])}
            </Text>
          </span>
        </ConfirmButton>
      ))}
    </div>
  );
}

type Props = {
  trackId: number;
  /** There are lyrics showing that a fix would replace. */
  hasLyrics: boolean;
  /** Search is what's needed here, so its box starts out open. */
  startsSearching: boolean;
  /** A fix went through, and its lyrics are on the way. */
  onDone: () => void;
};

/** Search, load a file, start over or find the file. Available on any track, whatever it has or hasn't got. */
export function LyricsFixes({ trackId, hasLyrics, startsSearching, onDone }: Props) {
  const current = usePlayer((state) => state.current);
  const [isSearching, setIsSearching] = useState(startsSearching);
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
    <div className="flex min-h-0 w-full flex-col">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" aria-expanded={isSearching} onClick={() => setIsSearching(!isSearching)}>
          Search
        </Button>
        <ConfirmButton
          asks={hasLyrics}
          variant="outline"
          size="sm"
          loading={loadFile.isPending}
          onConfirm={() => loadFile.mutate()}
        >
          Load file
        </ConfirmButton>
        <ConfirmButton variant="outline" size="sm" loading={clear.isPending} onConfirm={() => clear.mutate()}>
          Clear
        </ConfirmButton>
        <Button variant="outline" size="sm" onClick={() => revealLyrics(trackId)}>
          Reveal in File Explorer
        </Button>
      </div>
      <Text as="p" variant="meta" color="muted" className="pt-1">
        {hasLyrics ? 'Replace these lyrics, or clear them to look again' : 'Find lyrics online or from a file'}
      </Text>

      <AnimatePresence initial={false}>
        {isSearching ? (
          <Unfolds key="box">
            <form className="flex h-tap gap-2" onSubmit={submit}>
              <Input
                aria-label="Search LRCLIB"
                placeholder="Artist and title"
                maxLength={200}
                autoFocus={!startsSearching}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <Button type="submit" variant="outline" size="icon" aria-label="Search" loading={search.isPending}>
                <Search aria-hidden />
              </Button>
            </form>
          </Unfolds>
        ) : null}
        {isSearching && search.isError ? (
          <Unfolds key="search-failed">
            <Failed message={search.error.message} onRetry={() => search.mutate(query.trim())} />
          </Unfolds>
        ) : null}
        {isSearching && search.isSuccess ? (
          <Unfolds key="hits">
            <Hits
              hits={search.data}
              choosingId={choose.isPending ? choose.variables : null}
              asks={hasLyrics}
              onChoose={(id) => choose.mutate(id)}
            />
          </Unfolds>
        ) : null}
        {choose.isError ? (
          <Unfolds key="choose-failed">
            <Failed message={choose.error.message} onRetry={() => choose.mutate(choose.variables)} />
          </Unfolds>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
