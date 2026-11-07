import { useQuery } from '@tanstack/react-query';
import type { DatasetId } from '@shared/domain';
import { addressOf, type OnlineServiceId, type OnlineServiceSettings } from '@shared/onlineServices';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Swap } from '@/components/ui/Swap';
import { Text } from '@/components/ui/Text';
import { ServicesDialog } from '@/features/Settings/components/ServicesDialog';
import { UpdateRow } from '@/features/Settings/components/UpdateRow';
import { cancelDataset, updateEverything } from '@/lib/dataActions';
import { dataStateQuery, settingsQuery } from '@/lib/libraryQueries';

type Words = {
  title: string;
  description: string;
  doneWords: string;
  missingWords: string;
  source: string | null;
  confirmWords: string | null;
};

const WORDS: Record<DatasetId, Words> = {
  library: {
    title: 'Library',
    description: 'Finds new, changed and removed files in your music folder, all on this PC',
    doneWords: 'tracks',
    missingWords: 'missing from disk',
    source: null,
    confirmWords: null,
  },
  lyrics: {
    title: 'Lyrics',
    description: "Gets lyrics from LRCLIB for tracks that don't have any, sending only names and track lengths",
    doneWords: 'looked up',
    missingWords: 'not yet',
    source: 'lrclib.net',
    confirmWords:
      "Asks LRCLIB for lyrics to every song that has none yet, sending each song's title, artist, album and length. It runs in the background, and you can cancel it.",
  },
  fingerprints: {
    title: 'Fingerprints',
    description: 'Works out what each track sounds like, for Radio and More like this, all on this PC',
    doneWords: 'analyzed',
    missingWords: 'not yet',
    source: null,
    confirmWords:
      'Listens to every song not analyzed yet, which takes about 2 hours the first time and works the processor hard meanwhile. Nothing leaves this PC, and you can cancel it.',
  },
  listeners: {
    title: 'Discover data',
    description:
      'Asks MusicBrainz and ListenBrainz what people who play your music also play, sending only artist and track names. Update asks about anything new, and again about anything last asked over 6 months ago, since that drifts',
    doneWords: 'looked up',
    missingWords: 'not yet',
    source: 'musicbrainz.org and labs.api.listenbrainz.org',
    confirmWords:
      'Asks MusicBrainz and ListenBrainz about every artist and song not looked up yet, or last looked up over 6 months ago, sending only their names. It takes about 2 hours the first time, and you can cancel it.',
  },
};

/** The datasets that ask online, and the services Configure sets for each. */
const SERVICES: Partial<Record<DatasetId, { title: string; services: readonly OnlineServiceId[] }>> = {
  lyrics: { title: 'Lyrics service', services: ['lrclib'] },
  listeners: { title: 'Discover services', services: ['musicbrainz', 'listenbrainz'] },
};

/** Where it asks now, which follows an address the person set. */
function sourceOf(id: DatasetId, settings: OnlineServiceSettings | undefined): string | null {
  const services = SERVICES[id]?.services;
  if (services === undefined || settings === undefined) return WORDS[id].source;
  return services.map((service) => new URL(addressOf(settings, service)).host).join(' and ');
}

const EVERYTHING_WORDS =
  'Rescans the folder, then gets missing lyrics from LRCLIB, analyzes new songs, and asks MusicBrainz and ListenBrainz about new artists and songs. The first time it takes a few hours. You can stop it at any point.';

export function DataTab() {
  const data = useQuery(dataStateQuery);
  const { data: onlineServices } = useQuery({ ...settingsQuery, select: (settings) => settings.onlineServices });
  const [isAsking, setIsAsking] = useState(false);
  const [configuring, setConfiguring] = useState<DatasetId | null>(null);
  const configured = configuring === null ? undefined : SERVICES[configuring];

  if (data.isPending) {
    return (
      <div aria-hidden className="flex animate-appear-late flex-col gap-section pt-section">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (data.isError) return <ErrorState error={data.error} onRetry={() => void data.refetch()} />;

  const { datasets, isRunningAll } = data.data;

  return (
    <section aria-label="Data" className="content-in flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-gap gap-y-2 py-section">
        <Text as="p" variant="meta" color="muted" className="min-w-0 flex-[1_1_20em]">
          Nothing here runs by itself. Update brings each one up to date, and Update everything runs them all in turn
        </Text>
        <Swap id={isRunningAll ? 'running' : 'idle'} className="shrink-0">
          {isRunningAll ? (
            <Button variant="outline" size="md" onClick={() => cancelDataset(null)}>
              Stop everything
            </Button>
          ) : (
            <Button variant="primary" size="md" onClick={() => setIsAsking(true)}>
              Update everything
            </Button>
          )}
        </Swap>
      </div>
      {/* The library's own update is Rescan, on the Library tab. Update everything still starts with it. */}
      {datasets
        .filter(({ id }) => id !== 'library')
        .map((dataset) => (
          <UpdateRow
            key={dataset.id}
            dataset={dataset}
            {...WORDS[dataset.id]}
            source={sourceOf(dataset.id, onlineServices)}
            onConfigure={SERVICES[dataset.id] === undefined ? null : () => setConfiguring(dataset.id)}
          />
        ))}
      <ServicesDialog
        title={configured?.title ?? ''}
        services={configured?.services ?? []}
        open={configured !== undefined}
        onOpenChange={(open) => {
          if (!open) setConfiguring(null);
        }}
      />
      {isAsking ? (
        <ConfirmDialog
          title="Update everything?"
          description={EVERYTHING_WORDS}
          confirmLabel="Update everything"
          isDanger={false}
          onConfirm={updateEverything}
          onClose={() => setIsAsking(false)}
        />
      ) : null}
    </section>
  );
}
