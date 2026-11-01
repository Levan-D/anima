import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, type ReactNode } from 'react';
import type { RadioProblem, Track } from '@shared/domain';
import { AlbumArt } from '@/components/music/AlbumArt';
import { Barrel, type BarrelItem } from '@/components/ui/Barrel';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { joinParts } from '@/lib/format';
import { backToQueue, playRadio } from '@/lib/playerActions';
import { radioPreviewQuery } from '@/lib/playerQueries';
import { usePlayer } from '@/lib/playerStore';
import { openSettings } from '@/lib/settingsDialog';

const PROBLEM_WORDS: Record<RadioProblem, string> = {
  'no-data': 'Radio goes by fingerprints and listener data, and there are none yet',
  'nothing-close': 'Nothing in the library is close enough to this one',
  'ran-out': 'Radio has nothing close left to play',
};

function selectItem({ key }: BarrelItem): void {
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
      face: <AlbumArt hash={track.artHash} title={track.album ?? track.title} size="full" className="size-full" />,
    };
  });
}

type Props = {
  /** The art that's playing. Composed by the page, since it belongs to another feature. */
  art: ReactNode;
  transport: ReactNode;
};

/**
 * What radio would play next, around what's playing. Looking at it changes nothing: pressing something on the barrel, or
 * Play from here, is what makes radio the source. From then on the list comes from main, along with the current track.
 */
export function Radio({ art, transport }: Props) {
  const isSource = usePlayer((state) => state.radio.isSource);
  const isStarting = usePlayer((state) => state.radio.isStarting);
  const hasSavedQueue = usePlayer((state) => state.radio.hasSavedQueue);
  const stateProblem = usePlayer((state) => state.radio.problem);
  const past = usePlayer((state) => state.radio.past);
  const upNext = usePlayer((state) => state.radio.upNext);
  const current = usePlayer((state) => state.current);

  const preview = useQuery({
    ...radioPreviewQuery(current?.id ?? null),
    enabled: !isSource,
    placeholderData: keepPreviousData,
  });
  const seed = preview.data?.seed ?? null;
  const shownCurrent = current ?? seed;
  const previewNext = preview.data?.upNext;
  const aheadCount = isSource ? upNext.length : (previewNext?.length ?? 0);
  const centerIndex = isSource ? past.length : 0;

  const items = useMemo(
    () =>
      toItems([
        ...(isSource ? past : []),
        ...(shownCurrent === null ? [] : [shownCurrent]),
        ...(isSource ? upNext : (previewNext ?? [])),
      ]),
    [isSource, past, shownCurrent, upNext, previewNext],
  );

  const isSeedShown = current === null && seed !== null;
  const center = isSeedShown ? (
    <AlbumArt hash={seed.artHash} title={seed.album ?? seed.title} size="full" className="size-full" />
  ) : (
    art
  );
  const problem = stateProblem ?? (isSource ? null : (preview.data?.problem ?? null));

  return (
    <div data-testid="radio" className="flex min-h-0 flex-1 flex-col">
      <Barrel
        label="What radio plays next"
        items={items}
        centerIndex={centerIndex}
        center={<div className="relative size-full overflow-hidden rounded-md shadow-2xl">{center}</div>}
        onSelect={selectItem}
        className="flex-1 py-2"
      />

      <div className="flex min-h-tap shrink-0 flex-wrap items-center justify-center gap-x-gap px-gutter text-center">
        {isSeedShown ? (
          <Text color="muted" truncate>
            {joinParts(seed.title, seed.artist)}
          </Text>
        ) : null}
        {preview.isError && !isSource ? (
          <>
            <Text color="muted">Radio couldn't look for what's next</Text>
            <Button variant="ghost" onClick={() => void preview.refetch()}>
              Try again
            </Button>
          </>
        ) : null}
        {problem === null ? null : <Text color="muted">{PROBLEM_WORDS[problem]}</Text>}
        {problem === 'no-data' ? (
          <Button variant="ghost" onClick={() => openSettings('data')}>
            Settings → Data
          </Button>
        ) : null}
        {!isSource && problem !== 'no-data' ? (
          <Button
            variant="primary"
            loading={isStarting}
            disabled={shownCurrent === null || aheadCount === 0}
            onClick={() => playRadio(null)}
          >
            Play from here
          </Button>
        ) : null}
        {hasSavedQueue ? (
          <Button variant="quiet" size="compact" onClick={backToQueue}>
            Back to your queue
          </Button>
        ) : null}
      </div>

      {transport}
    </div>
  );
}
