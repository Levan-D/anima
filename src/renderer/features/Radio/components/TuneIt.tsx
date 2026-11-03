import { useQuery } from '@tanstack/react-query';
import { History, RadioTower, Settings, Shuffle, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { WANDER_MIDDLE, type RadioStartFrom } from '@shared/domain';
import { AlbumArt } from '@/components/music/AlbumArt';
import { Button } from '@/components/ui/Button';
import { Collapse } from '@/components/ui/Collapse';
import { Divider } from '@/components/ui/Divider';
import { ErrorState } from '@/components/ui/ErrorState';
import { Modal } from '@/components/ui/Modal';
import { PillGroup } from '@/components/ui/PillGroup';
import { SearchInput } from '@/components/ui/SearchInput';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { Tooltip } from '@/components/ui/Tooltip';
import { formatCount } from '@/lib/format';
import { albumsQuery, searchQuery, settingsQuery } from '@/lib/libraryQueries';
import { goBack } from '@/lib/navigation';
import { openSettings } from '@/lib/pages';
import { startRadio } from '@/lib/playerActions';
import { radioStartOptionsQuery } from '@/lib/playerQueries';
import { decadeCovers } from '../utils/decadeCovers';
import { shuffledBy } from '../utils/shuffledBy';
import { BlendSection } from './BlendSection';
import { RadioSettings } from './RadioSettings';
import { SearchResultState } from './SearchResultState';

type StartFn = (from: RadioStartFrom) => void;

const ALL_ALBUMS = { artistId: null, genreId: null } as const;
// Fanned like a hand of records, the biggest album on top.
const COVER_PLACES = ['left-0 -rotate-6', 'left-1/4 z-10', 'left-1/2 rotate-6'] as const;

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

type QuickProps = {
  icon: LucideIcon;
  title: string;
  says: string;
  variant: 'primary' | 'complement';
  onPress: () => void;
};

function Quick({ icon: Icon, title, says, variant, onPress }: QuickProps) {
  return (
    <Button
      variant={variant}
      size="lg"
      className="min-h-20 min-w-48 flex-1 justify-start py-3 [&_svg]:size-7 [&>span]:justify-start [&>span]:gap-3"
      onClick={onPress}
    >
      <Icon aria-hidden />
      <span className="flex min-w-0 flex-col items-start">
        <Text variant="lead" color="inherit">
          {title}
        </Text>
        <Text variant="meta" color="inherit" className="opacity-80">
          {says}
        </Text>
      </span>
    </Button>
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

function decadeLabel(decade: number): string {
  return decade < 2000 ? `${decade % 100}s` : `${decade}s`;
}

function PillsSkeleton() {
  return (
    <div aria-hidden className="flex gap-1.5">
      <Skeleton className="h-7 w-20 rounded-full" />
      <Skeleton className="h-7 w-16 rounded-full" />
      <Skeleton className="h-7 w-24 rounded-full" />
    </div>
  );
}

type DecadeProps = {
  decade: number;
  tracks: number;
  onStart: StartFn;
};

function DecadeTile({ decade, tracks, onStart }: DecadeProps) {
  const albums = useQuery(albumsQuery(ALL_ALBUMS));
  const covers = decadeCovers(albums.data ?? [], decade);

  return (
    <Button
      variant="card"
      size="card"
      className="w-28 flex-none"
      aria-label={`Start from the ${decadeLabel(decade)}`}
      onClick={() => onStart({ kind: 'decade', decade })}
    >
      <span aria-hidden className="relative block h-20 w-full">
        {covers.map(({ id, artHash, title }, index) => (
          <AlbumArt
            key={id}
            hash={artHash}
            title={title}
            surface="sleeve"
            className={`absolute top-2 size-14 transition-transform duration-(--dur-fast) ease-standard group-hover:-translate-y-1 ${COVER_PLACES[index] ?? ''}`}
          />
        ))}
      </span>
      <Text variant="lead">{decadeLabel(decade)}</Text>
      <Text variant="meta" color="muted">
        {`${formatCount(tracks)} songs`}
      </Text>
    </Button>
  );
}

function OptionSections({ onStart }: { onStart: StartFn }) {
  const options = useQuery(radioStartOptionsQuery);
  // A new order each time Tune it opens, so it isn't the biggest few at the top every time.
  const [seed] = useState(Math.random);

  if (options.isPending) {
    return (
      <>
        <Section title="A decade">
          <PillsSkeleton />
        </Section>
        <Divider />
        <Section title="A genre">
          <PillsSkeleton />
        </Section>
      </>
    );
  }
  if (options.isError) {
    return <ErrorState error={options.error} onRetry={() => void options.refetch()} className="size-auto" />;
  }

  const { genres, decades } = options.data;
  return (
    <>
      <Section title="A decade">
        {decades.length === 0 ? (
          <Text color="muted">No years in the tags. Scan a folder that has some</Text>
        ) : (
          <div className="flex flex-wrap gap-x-gap gap-y-2">
            {decades.map(({ decade, tracks }) => (
              <DecadeTile key={decade} decade={decade} tracks={tracks} onStart={onStart} />
            ))}
          </div>
        )}
      </Section>
      <Divider />
      <Section title="A genre">
        {genres.length === 0 ? (
          <Text color="muted">No genres in the tags. Scan a folder that has some</Text>
        ) : (
          <PillGroup
            label="Start from a genre"
            wraps
            items={shuffledBy(genres, ({ name }) => name, seed).map(({ name, tracks }) => ({
              value: name,
              label: name,
              count: tracks,
            }))}
            value={[]}
            onValueChange={([genre]) => {
              if (genre !== undefined) onStart({ kind: 'genre', genre });
            }}
          />
        )}
      </Section>
    </>
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
      <Divider />
    </Collapse>
  );
}

/**
 * A button for the Radio page's transport, and the places radio can start from that it opens. How radio behaves once
 * it's playing is behind the cog, in Radio settings, since it's set now and then rather than each time.
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
        size="lg"
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
          <div className="flex flex-wrap gap-gap p-gutter">
            <Quick
              icon={Shuffle}
              title="Surprise me"
              says="Anywhere in your library"
              variant="primary"
              onPress={() => start({ kind: 'surprise', randomSeed: null })}
            />
            <Quick
              icon={History}
              title="Something forgotten"
              says="Not played in 90 days, or ever"
              variant="complement"
              onPress={() => start({ kind: 'forgotten' })}
            />
          </div>
          <MissingFingerprints
            onOpenSettings={() => {
              setIsOpen(false);
              openSettings('data');
            }}
          />
          <Divider />
          <OptionSections onStart={start} />
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
