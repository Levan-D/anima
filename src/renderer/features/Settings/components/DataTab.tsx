import { useQuery } from '@tanstack/react-query';
import type { DatasetId } from '@shared/domain';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Divider } from '@/components/ui/Divider';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Swap } from '@/components/ui/Swap';
import { Text } from '@/components/ui/Text';
import { UpdateRow } from '@/features/Settings/components/UpdateRow';
import { cancelDataset, refreshListenerData, updateEverything } from '@/lib/dataActions';
import { dataStateQuery } from '@/lib/libraryQueries';

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
      'Asks MusicBrainz and ListenBrainz what people who play your music also play, sending only artist and track names',
    doneWords: 'looked up',
    missingWords: 'not yet',
    source: 'musicbrainz.org and labs.api.listenbrainz.org',
    confirmWords:
      'Asks MusicBrainz and ListenBrainz about every artist and song not looked up yet, sending only their names. It takes about 2 hours the first time, and you can cancel it.',
  },
};

const EVERYTHING_WORDS =
  'Rescans the folder, then gets missing lyrics from LRCLIB, analyzes new songs, and asks MusicBrainz and ListenBrainz about new artists and songs. The first time it takes a few hours. You can stop it at any point.';
const REFRESH_WORDS =
  'Asks MusicBrainz and ListenBrainz again about every artist and song, not only new ones, to pick up what has changed there. It takes about 2 hours, sending only names.';

export function DataTab() {
  const data = useQuery(dataStateQuery);
  const [asking, setAsking] = useState<'everything' | 'refresh' | null>(null);

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
  const isRefreshing = datasets.some(({ id, progress }) => id === 'listeners' && progress !== null);

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
            <Button variant="primary" size="md" onClick={() => setAsking('everything')}>
              Update everything
            </Button>
          )}
        </Swap>
      </div>
      {datasets.map((dataset) => (
        <UpdateRow key={dataset.id} dataset={dataset} {...WORDS[dataset.id]} />
      ))}
      <Divider />
      <div className="flex flex-wrap items-center justify-between gap-x-gap gap-y-2 py-section">
        <Text as="p" variant="meta" color="muted" className="min-w-0 flex-[1_1_20em]">
          Update on Discover data only asks about artists and songs it hasn't looked up. Refresh asks again about all of
          them, to catch what's changed since
        </Text>
        <Button variant="outline" size="md" disabled={isRefreshing} onClick={() => setAsking('refresh')}>
          Refresh discover data
        </Button>
      </div>
      {asking === null ? null : (
        <ConfirmDialog
          title={asking === 'everything' ? 'Update everything?' : 'Refresh discover data?'}
          description={asking === 'everything' ? EVERYTHING_WORDS : REFRESH_WORDS}
          confirmLabel={asking === 'everything' ? 'Update everything' : 'Refresh'}
          isDanger={false}
          onConfirm={asking === 'everything' ? updateEverything : refreshListenerData}
          onClose={() => setAsking(null)}
        />
      )}
    </section>
  );
}
