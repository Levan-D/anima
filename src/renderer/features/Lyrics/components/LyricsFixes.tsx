import { Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState, type FormEvent, type ReactNode } from 'react';
import type { LyricsSearchHit } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { ConfirmButton } from '@/components/ui/ConfirmButton';
import { ConfirmIconButton } from '@/components/ui/ConfirmIconButton';
import { SearchInput } from '@/components/ui/SearchInput';
import { Text } from '@/components/ui/Text';
import { formatDuration, joinParts } from '@/lib/format';
import {
  useChooseLyrics,
  useClearLyrics,
  useLoadLyricsFile,
  usePasteLyrics,
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

// Matches Input, which is one line only.
const PASTE_BOX =
  'w-full resize-y rounded-md border border-divider bg-surface-raised px-3 py-2 text-body text-text select-text placeholder:text-text-muted';

/** Search, load a file or start over. Available on any track, whatever it has or hasn't got. */
export function LyricsFixes({ trackId, hasLyrics, startsSearching, onDone }: Props) {
  const current = usePlayer((state) => state.current);
  const [isSearching, setIsSearching] = useState(startsSearching);
  const [query, setQuery] = useState(() => (current === null ? '' : `${current.artist} ${current.title}`));
  const search = useSearchLyrics();
  const choose = useChooseLyrics(trackId, onDone);
  const loadFile = useLoadLyricsFile(trackId, onDone);
  const paste = usePasteLyrics(trackId, onDone);
  const [isPasting, setIsPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const clear = useClearLyrics(trackId, onDone);

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (query.trim() !== '') search.mutate(query.trim());
  }

  return (
    <div className="flex min-h-0 w-full flex-col">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="md" aria-expanded={isSearching} onClick={() => setIsSearching(!isSearching)}>
            Search online
          </Button>
          <Button variant="outline" size="md" loading={loadFile.isPending} onClick={() => loadFile.mutate()}>
            Load file
          </Button>
          <Button variant="outline" size="md" aria-expanded={isPasting} onClick={() => setIsPasting(!isPasting)}>
            Paste
          </Button>
        </div>
        <ConfirmIconButton
          label="Clear lyrics"
          icon={Trash2}
          loading={clear.isPending}
          onConfirm={() => clear.mutate()}
        />
      </div>

      <AnimatePresence initial={false}>
        {isPasting ? (
          <Unfolds key="paste">
            <form
              className="flex flex-col gap-2 pt-2"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                if (pasted.trim() !== '') paste.mutate(pasted);
              }}
            >
              <textarea
                aria-label="Lyrics to paste"
                placeholder="Paste the lyrics. Lines with [mm:ss] times light up as they're sung"
                value={pasted}
                maxLength={200_000}
                rows={8}
                onChange={(event) => setPasted(event.target.value)}
                className={PASTE_BOX}
              />
              {paste.isError ? (
                <Text as="p" variant="meta" color="danger" role="alert">
                  {paste.error.message}
                </Text>
              ) : null}
              <Button
                type="submit"
                size="md"
                className="self-end"
                disabled={pasted.trim() === ''}
                loading={paste.isPending}
              >
                Save lyrics
              </Button>
            </form>
          </Unfolds>
        ) : null}
        {isSearching ? (
          <Unfolds key="box">
            <form onSubmit={submit}>
              <SearchInput
                value={query}
                onValueChange={setQuery}
                label="Search LRCLIB"
                placeholder="Artist and title, then Enter"
              />
            </form>
          </Unfolds>
        ) : null}
        {isSearching && search.isPending ? (
          <Unfolds key="searching">
            <Text as="p" variant="meta" color="muted">
              Searching LRCLIB
            </Text>
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
