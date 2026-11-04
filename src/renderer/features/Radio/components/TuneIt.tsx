import { useQuery } from '@tanstack/react-query';
import { History, RadioTower, Settings, Shuffle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { WANDER_MIDDLE, type RadioStartFrom, type RadioStartOptions } from '@shared/domain';
import { AlbumArt } from '@/components/music/AlbumArt';
import { Button } from '@/components/ui/Button';
import { Collapse } from '@/components/ui/Collapse';
import { Divider } from '@/components/ui/Divider';
import { ErrorState } from '@/components/ui/ErrorState';
import { Modal } from '@/components/ui/Modal';
import { SearchInput } from '@/components/ui/SearchInput';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { Tooltip } from '@/components/ui/Tooltip';
import { formatCount } from '@/lib/format';
import { searchQuery, settingsQuery } from '@/lib/libraryQueries';
import { goBack } from '@/lib/navigation';
import { openSettings } from '@/lib/pages';
import { startRadio } from '@/lib/playerActions';
import { radioStartOptionsQuery } from '@/lib/playerQueries';
import { shuffledBy } from '../utils/shuffledBy';
import { BlendSection } from './BlendSection';
import { RadioSettings } from './RadioSettings';
import { SearchResultState } from './SearchResultState';

type StartFn = (from: RadioStartFrom) => void;
type Genre = RadioStartOptions['genres'][number];

const MIDDLE = 'left-1/2 -translate-x-1/2';
// Fanned like a hand of records, the most common cover in front, laid out for however many a genre has.
const COVER_PLACES: Record<number, readonly string[]> = {
  1: [MIDDLE],
  2: ['left-2 z-10 -rotate-3', 'right-2 rotate-3'],
  3: [`${MIDDLE} z-10`, 'left-0 -rotate-6', 'right-0 rotate-6'],
};
const SKELETON_TILES = 8;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex shrink-0 flex-col gap-gap p-gutter">
      <Text as="h3" variant="meta" color="muted">
        {title}
      </Text>
      {children}
    </section>
  );
}

function SongSection({ onStart }: { onStart: StartFn }) {
  const [query, setQuery] = useState('');
  const text = query.trim();
  const results = useQuery({ ...searchQuery(text), enabled: text !== '' });
  const tracks = results.data?.tracks.slice(0, 6) ?? [];

  return (
    <Section title="A song">
      <SearchInput value={query} onValueChange={setQuery} label="Search for a song to start from" />
      <Collapse open={text !== ''}>
        <SearchResultState
          isLoading={results.isPending}
          isEmpty={tracks.length === 0}
          emptyWords="No songs match. Try fewer words"
          error={results.error}
          onRetry={() => void results.refetch()}
        >
          {tracks.map((track) => (
            <Button
              key={track.id}
              variant="row"
              size="row"
              className="h-row"
              onClick={() => onStart({ kind: 'track', trackId: track.id })}
            >
              <AlbumArt hash={track.artHash} title={track.album ?? track.title} className="size-8 shrink-0" />
              <Text truncate className="min-w-0 flex-1">
                {track.title}
              </Text>
              <Text variant="meta" color="muted" truncate className="max-w-1/2 min-w-0 shrink-0">
                {track.artist}
              </Text>
            </Button>
          ))}
        </SearchResultState>
      </Collapse>
    </Section>
  );
}

function GenreTile({ genre: { name, tracks, covers }, onStart }: { genre: Genre; onStart: StartFn }) {
  const places = COVER_PLACES[covers.length] ?? [];
  return (
    <Button
      variant="card"
      size="card"
      className="w-36 flex-none text-center"
      aria-label={`Start from ${name}`}
      onClick={() => onStart({ kind: 'genre', genre: name })}
    >
      <span aria-hidden className="relative block h-28 w-full">
        {covers.map((hash, index) => (
          <AlbumArt
            key={hash}
            hash={hash}
            title={name}
            surface="sleeve"
            className={`absolute top-2 size-20 ${places[index] ?? 'hidden'}`}
          />
        ))}
      </span>
      <Text variant="lead" truncate>
        {name}
      </Text>
      <Text variant="meta" color="muted">
        {`${formatCount(tracks)} songs`}
      </Text>
    </Button>
  );
}

function GenreTiles({ onStart }: { onStart: StartFn }) {
  const options = useQuery(radioStartOptionsQuery);
  // A new order each time Tune it opens, so it isn't the biggest few at the top every time.
  const [seed] = useState(Math.random);

  if (options.isPending) {
    return (
      <div aria-hidden className="flex flex-wrap justify-center gap-gap">
        {Array.from({ length: SKELETON_TILES }, (_, index) => (
          <Skeleton key={index} className="h-40 w-36 rounded-md" />
        ))}
      </div>
    );
  }
  if (options.isError) {
    return <ErrorState error={options.error} onRetry={() => void options.refetch()} className="size-auto" />;
  }
  if (options.data.genres.length === 0) {
    return <Text color="muted">No genres in the tags. Scan a folder that has some</Text>;
  }
  return (
    <div className="flex w-full flex-wrap justify-center gap-x-gap gap-y-section">
      {shuffledBy(options.data.genres, ({ name }) => name, seed).map((genre) => (
        <GenreTile key={genre.name} genre={genre} onStart={onStart} />
      ))}
    </div>
  );
}

function MissingFingerprints({ onOpenSettings }: { onOpenSettings: () => void }) {
  const options = useQuery(radioStartOptionsQuery);
  const missing = options.data === undefined ? 0 : options.data.tracks - options.data.fingerprinted;

  return (
    <Collapse open={missing > 0} className="shrink-0">
      <div className="flex flex-wrap items-center gap-x-gap px-gutter py-1">
        <Text variant="meta" color="muted" className="min-w-0 flex-1">
          {`${formatCount(missing)} tracks have no fingerprint yet, so radio can't go by their sound`}
        </Text>
        <Button variant="ghost" onClick={onOpenSettings}>
          Settings → Data
        </Button>
      </div>
    </Collapse>
  );
}

/**
 * A button for the Radio page's transport, and the places radio can start from that it opens. A genre is the usual
 * way in, so it leads. How radio behaves once it's playing is behind the cog, in Radio settings.
 */
export function TuneIt() {
  const [isOpen, setIsOpen] = useState(false);
  const [areSettingsOpen, setAreSettingsOpen] = useState(false);
  const wander = useQuery({ ...settingsQuery, select: (settings) => settings.radioWander });

  function start(from: RadioStartFrom): void {
    startRadio(from, wander.data ?? WANDER_MIDDLE);
    setIsOpen(false);
  }

  return (
    <>
      <Tooltip label="Where radio starts" onEscape={goBack}>
        <Button variant="secondary" size="sm" className="shrink-0" onClick={() => setIsOpen(true)}>
          <RadioTower aria-hidden />
          Tune it
        </Button>
      </Tooltip>
      <Modal
        open={isOpen}
        onOpenChange={setIsOpen}
        title="Tune it"
        closeLabel="Close Tune it"
        size="tall"
        titleAside={
          <Tooltip label="Radio settings">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Radio settings"
              data-testid="radio-settings-open"
              onClick={() => {
                setIsOpen(false);
                setAreSettingsOpen(true);
              }}
            >
              <Settings aria-hidden />
            </Button>
          </Tooltip>
        }
      >
        <div data-testid="tune-it" className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
          <Section title="Pick a genre">
            <GenreTiles onStart={start} />
          </Section>
          <MissingFingerprints
            onOpenSettings={() => {
              setIsOpen(false);
              openSettings('data');
            }}
          />
          <Divider />
          <Section title="Or let radio pick">
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="md" onClick={() => start({ kind: 'surprise', randomSeed: null })}>
                <Shuffle aria-hidden />
                Surprise me
              </Button>
              <Button variant="secondary" size="md" onClick={() => start({ kind: 'forgotten' })}>
                <History aria-hidden />
                Something forgotten
              </Button>
            </div>
            <Text variant="meta" color="muted">
              Surprise me starts anywhere in your library. Forgotten is what you haven't played in 90 days, or ever
            </Text>
          </Section>
          <Divider />
          <SongSection onStart={start} />
          <Divider />
          <BlendSection onStart={start} />
        </div>
      </Modal>
      <RadioSettings open={areSettingsOpen} onOpenChange={setAreSettingsOpen} />
    </>
  );
}
