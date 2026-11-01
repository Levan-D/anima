import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, type ReactNode } from 'react';
import type { QueueItem, RadioProblem, Track } from '@shared/domain';
import { AlbumArt } from '@/components/music/AlbumArt';
import { AlbumBackdrop } from '@/components/music/AlbumBackdrop';
import { VinylDisc } from '@/components/music/VinylDisc';
import { TuneInDrawer } from './components/TuneInDrawer';
import { Barrel, type BarrelItem } from '@/components/ui/Barrel';
import { Button } from '@/components/ui/Button';
import { Collapse } from '@/components/ui/Collapse';
import { Text } from '@/components/ui/Text';
import { joinParts } from '@/lib/format';
import { openSettings } from '@/lib/pages';
import { playRadio } from '@/lib/playerActions';
import { queueQuery, radioPreviewQuery } from '@/lib/playerQueries';
import { usePlayer } from '@/lib/playerStore';

const PROBLEM_WORDS: Record<RadioProblem, string> = {
  'no-data': 'Radio goes by fingerprints and listener data, and there are none yet',
  'no-fingerprints': 'What you chose has no fingerprints yet, and radio goes by sound from there',
  'nothing-close': 'Nothing in the library is close enough to this one',
  'ran-out': 'Radio has nothing close left to play',
};

function needsFingerprints(problem: RadioProblem | null): boolean {
  return problem === 'no-data' || problem === 'no-fingerprints';
}

const NOTHING_YET: Track[] = [];
const BROWSE_RETURN_MS = 3000;
const MOST_PAST = 12;

function playItem({ key }: BarrelItem): void {
  const trackId = Number.parseInt(key, 10);
  if (Number.isFinite(trackId)) playRadio(trackId);
}

function toItems(tracks: readonly Track[]): BarrelItem[] {
  const seen = new Map<number, number>();
  return tracks.map((track) => {
    const times = seen.get(track.id) ?? 0;
    seen.set(track.id, times + 1);
    return {
      // By track, so one the preview showed keeps its place on the barrel when radio takes over.
      key: times === 0 ? `${track.id}` : `${track.id}-${times}`,
      label: joinParts(track.title, track.artist),
      face: (
        <AlbumArt
          hash={track.artHash}
          title={track.album ?? track.title}
          size="full"
          surface="sleeve"
          className="size-full"
        />
      ),
      behind: <VinylDisc hash={track.artHash} />,
    };
  });
}

/** The state only carries a few played tracks, and radio's queue holds more. It can lag the index by a moment. */
function pastToBrowse(
  queue: readonly QueueItem[] | undefined,
  index: number | null,
  currentId: number | null,
  shortPast: readonly Track[],
): readonly Track[] {
  if (queue === undefined || index === null || queue[index]?.track.id !== currentId) return shortPast;
  return queue.slice(Math.max(index - MOST_PAST, 0), index).map(({ track }) => track);
}

type Props = {
  /** The art that's playing. Composed by the page, since it belongs to another feature. */
  art: ReactNode;
};

/**
 * What radio would play next, around what's playing. Looking at it changes nothing: playing something on the barrel is what
 * makes radio the source. From then on the list comes from main, along with the current track.
 */
export function Radio({ art }: Props) {
  const isSource = usePlayer((state) => state.radio.isSource);
  const isStarting = usePlayer((state) => state.radio.isStarting);
  const stateProblem = usePlayer((state) => state.radio.problem);
  const shortPast = usePlayer((state) => state.radio.past);
  const upNext = usePlayer((state) => state.radio.upNext);
  const current = usePlayer((state) => state.current);
  const queueVersion = usePlayer((state) => state.queueVersion);
  const queueIndex = usePlayer((state) => state.queueIndex);

  const preview = useQuery({
    ...radioPreviewQuery(current?.id ?? null),
    enabled: !isSource,
    placeholderData: keepPreviousData,
  });
  const queue = useQuery({ ...queueQuery(queueVersion), enabled: isSource, placeholderData: keepPreviousData });
  const past = useMemo(
    () => (isSource ? pastToBrowse(queue.data, queueIndex, current?.id ?? null, shortPast) : []),
    [isSource, queue.data, queueIndex, current?.id, shortPast],
  );

  const seed = preview.data?.seed ?? null;
  const shownCurrent = current ?? seed;
  const previewNext = preview.data?.upNext;
  // Whatever's ahead is about to be replaced.
  const shownNext = isSource ? upNext : previewNext;
  const next = isStarting ? NOTHING_YET : shownNext;

  const items = useMemo(
    () => toItems([...past, ...(shownCurrent === null ? [] : [shownCurrent]), ...(next ?? [])]),
    [past, shownCurrent, next],
  );

  const isSeedShown = current === null && seed !== null;
  const center = isSeedShown ? (
    <AlbumArt hash={seed.artHash} title={seed.album ?? seed.title} size="full" className="size-full" />
  ) : (
    art
  );
  const problem = stateProblem ?? (isSource ? null : (preview.data?.problem ?? null));
  const couldntLook = preview.isError && !isSource;
  // As the source with nothing ahead and no problem, it's topping up.
  const isWaitingForPicks = isStarting || isSource || preview.isFetching;
  const isLoading = problem === null && !couldntLook && (next ?? []).length === 0 && isWaitingForPicks;
  const seedWords = isSeedShown ? joinParts(seed.title, seed.artist) : null;
  const status = isLoading || isStarting ? "Radio is finding what's next" : seedWords;

  return (
    <div data-testid="radio" className="flex min-h-0 flex-1 flex-col pb-island-clear">
      <AlbumBackdrop intensity={1} drifts className="fixed inset-0" />
      <TuneInDrawer />
      <Barrel
        label="What radio plays next"
        items={items}
        centerIndex={past.length}
        center={<div className="relative size-full overflow-hidden rounded-sm shadow-sleeve-lifted">{center}</div>}
        onPlay={playItem}
        returnAfterMs={BROWSE_RETURN_MS}
        isLoading={isLoading}
        status={status}
        className="flex-1 pt-2"
      />

      <Collapse open={couldntLook || problem !== null} className="shrink-0">
        <div className="flex min-h-tap flex-wrap items-center justify-center gap-x-gap px-gutter text-center">
          {couldntLook ? (
            <>
              <Text color="muted">Radio couldn't look for what's next</Text>
              <Button variant="ghost" onClick={() => void preview.refetch()}>
                Try again
              </Button>
            </>
          ) : null}
          {problem === null ? null : <Text color="muted">{PROBLEM_WORDS[problem]}</Text>}
          {needsFingerprints(problem) ? (
            <Button variant="ghost" onClick={() => openSettings('data')}>
              Settings → Data
            </Button>
          ) : null}
        </div>
      </Collapse>
    </div>
  );
}
