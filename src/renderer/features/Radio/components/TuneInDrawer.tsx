import { useQuery } from '@tanstack/react-query';
import { RadioTower } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { WANDER_MIDDLE, type RadioStartFrom } from '@shared/domain';
import { AlbumArt } from '@/components/music/AlbumArt';
import { Button } from '@/components/ui/Button';
import { Collapse } from '@/components/ui/Collapse';
import { Divider } from '@/components/ui/Divider';
import { Drawer } from '@/components/ui/Drawer';
import { ErrorState } from '@/components/ui/ErrorState';
import { PillGroup } from '@/components/ui/PillGroup';
import { SearchInput } from '@/components/ui/SearchInput';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { Tooltip } from '@/components/ui/Tooltip';
import { formatCount } from '@/lib/format';
import { searchQuery, settingsQuery } from '@/lib/libraryQueries';
import { goBack } from '@/lib/navigation';
import { openSettings } from '@/lib/pages';
import { setRadioWander, startRadio } from '@/lib/playerActions';
import { radioStartOptionsQuery } from '@/lib/playerQueries';
import { useRadioSlider } from '../hooks/useRadioSlider';
import { BlendSection } from './BlendSection';
import { EnergySection } from './EnergySection';
import { SeasonsLine } from './SeasonsLine';
import { RadioSliderSection } from './RadioSliderSection';
import { SearchResultState } from './SearchResultState';

type StartFn = (from: RadioStartFrom) => void;

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

function OptionSections({ onStart }: { onStart: StartFn }) {
  const options = useQuery(radioStartOptionsQuery);

  if (options.isPending) {
    return (
      <>
        <Section title="A genre">
          <PillsSkeleton />
        </Section>
        <Divider />
        <Section title="A decade">
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
      <Section title="A genre">
        {genres.length === 0 ? (
          <Text color="muted">No genres in the tags. Scan a folder that has some</Text>
        ) : (
          <PillGroup
            label="Start from a genre"
            rows={3}
            items={genres.map(({ name, tracks }) => ({ value: name, label: name, count: tracks }))}
            value={[]}
            onValueChange={([genre]) => {
              if (genre !== undefined) onStart({ kind: 'genre', genre });
            }}
          />
        )}
      </Section>
      <Divider />
      <Section title="A decade">
        {decades.length === 0 ? (
          <Text color="muted">No years in the tags. Scan a folder that has some</Text>
        ) : (
          <PillGroup
            label="Start from a decade"
            rows={1}
            items={decades.map(({ decade, tracks }) => ({
              value: String(decade),
              label: decadeLabel(decade),
              count: tracks,
            }))}
            value={[]}
            onValueChange={([decade]) => {
              if (decade !== undefined) onStart({ kind: 'decade', decade: Number(decade) });
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

/** A button for the Radio page's transport, and the drawer of other places to start from that it opens. */
export function TuneInDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const saved = useQuery({ ...settingsQuery, select: (settings) => settings.radioWander });
  const wander = useRadioSlider(saved.data ?? WANDER_MIDDLE, setRadioWander);

  function start(from: RadioStartFrom): void {
    startRadio(from, wander.value);
    setIsOpen(false);
  }

  return (
    <>
      <Tooltip label="Other places to start from" onEscape={goBack}>
        <Button variant="secondary" size="sm" className="shrink-0" onClick={() => setIsOpen(true)}>
          <RadioTower aria-hidden />
          Tune in
        </Button>
      </Tooltip>
      <Drawer open={isOpen} onOpenChange={setIsOpen} title="Tune in" closeLabel="Close Tune in">
        <div data-testid="tune-in" className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
          <MissingFingerprints
            onOpenSettings={() => {
              setIsOpen(false);
              openSettings('data');
            }}
          />
          <Text as="p" variant="meta" color="muted" className="px-gutter pt-gutter">
            Choose where radio starts. It replaces what's ahead, and your queue is kept to come back to
          </Text>
          <SongSection onStart={start} />
          <Divider />
          <OptionSections onStart={start} />
          <Divider />
          <BlendSection onStart={start} />
          <Divider />
          <Section title="Forgotten">
            <Text variant="meta" color="muted">
              Not played in 90 days, or never. Stats only began recently, so some of it you may know well
            </Text>
            <Button className="self-start" onClick={() => start({ kind: 'forgotten' })}>
              Play something forgotten
            </Button>
          </Section>
          <Divider />
          <Section title="Surprise me">
            <Button className="self-start" onClick={() => start({ kind: 'surprise', randomSeed: null })}>
              Anywhere in the library
            </Button>
          </Section>
          <Divider />
          <RadioSliderSection
            title="Wander"
            description="How far radio may go from the sound it started on"
            label="How far radio may wander"
            low="Same vibe"
            high="Adventurous"
            slider={wander}
          />
          <Divider />
          <EnergySection
            onOpenSettings={() => {
              setIsOpen(false);
              openSettings('data');
            }}
          />
          <Divider />
          <SeasonsLine
            onOpenSettings={() => {
              setIsOpen(false);
              openSettings('seasons');
            }}
          />
        </div>
      </Drawer>
    </>
  );
}
