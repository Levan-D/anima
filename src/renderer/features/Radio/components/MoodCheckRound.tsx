import type { UseQueryResult } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import type { MoodCheck, MoodTry } from '@shared/stations';
import { AlbumArt } from '@/components/music/AlbumArt';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { ProgressLine } from '@/components/ui/ProgressLine';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/lib/cn';
import { formatPlural } from '@/lib/format';
import { playTracks } from '@/lib/playerActions';
import type { CheckAnswer, CheckAnswers } from '@/features/Radio/utils/moodDraft';
import { SayPill } from './SayPill';

type Props = {
  tried: UseQueryResult<MoodTry>;
  canTry: boolean;
  answers: CheckAnswers;
  onAnswer: (trackId: number, key: string, label: string, answer: CheckAnswer) => void;
  onNextRound: () => void;
};

const SKELETON_ROWS = 4;

function CheckRow({
  check,
  answer,
  onAnswer,
}: {
  check: MoodCheck;
  answer: CheckAnswer | null;
  onAnswer: Props['onAnswer'];
}) {
  const { track, key, label } = check;
  const say = (given: CheckAnswer) => onAnswer(track.id, key, label, given);
  return (
    <div className="flex min-h-row min-w-0 flex-wrap items-center gap-x-gap gap-y-1 py-1">
      <div className="flex min-w-0 flex-[1_1_16em] items-center gap-gap">
        {/* The ordinary play: the queue becomes this song, which is the quickest way to hear it. */}
        <Tooltip label="Play">
          <Button variant="ghost" size="icon-sm" aria-label={`Play ${track.title}`} onClick={() => playTracks([track])}>
            <Play aria-hidden />
          </Button>
        </Tooltip>
        <AlbumArt hash={track.artHash} title={track.album ?? track.title} className="size-8 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col">
          <Text truncate>{track.title}</Text>
          <Text variant="meta" color="muted" truncate>
            {track.artist}
          </Text>
        </div>
      </div>
      <div className="ml-auto flex shrink-0 gap-1.5">
        <SayPill isOn={answer === 'yes'} label={`Yes, ${track.title} belongs`} onClick={() => say('yes')}>
          Yes
        </SayPill>
        <SayPill isOn={answer === 'no'} isSecondary label={`No, ${track.title} doesn't`} onClick={() => say('no')}>
          No
        </SayPill>
        <SayPill isOn={answer === 'skip'} label={`Skip ${track.title}`} onClick={() => say('skip')}>
          Skip
        </SayPill>
      </div>
    </div>
  );
}

/**
 * The songs it's least sure about, a round at a time. Answers count when the next round is asked for, so the list holds
 * still while it's being answered.
 */
export function MoodCheckRound({ tried, canTry, answers, onAnswer, onNextRound }: Props) {
  const answered = Object.keys(answers).length;

  if (!canTry) {
    return (
      <Text as="p" variant="meta" color="muted">
        Once something sounds like it, this asks about the songs it&apos;s least sure of
      </Text>
    );
  }
  if (tried.isPending) {
    return (
      <div aria-hidden className="flex flex-col gap-1">
        <ProgressLine value={null} label="Working it out" />
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <Skeleton key={index} className="h-row w-full" />
        ))}
      </div>
    );
  }
  if (tried.isError)
    return <ErrorState error={tried.error} onRetry={() => void tried.refetch()} className="size-auto" />;
  const data = tried.data;
  if (data.problem !== null) {
    return (
      <Text as="p" variant="meta" color="muted">
        {data.problem === 'no-fingerprints'
          ? 'Nothing has a fingerprint yet. Mood stations go by sound, so they wait for fingerprints in Settings, Online and data'
          : 'None of what sounds like it is in the library now. Add something that is'}
      </Text>
    );
  }

  const { check } = data;
  const isWorking = tried.isFetching;
  return (
    <div className="flex flex-col gap-gap">
      <Text as="p" variant="meta" color="muted">
        Yes or no to each makes it surer of where the line is. Skip what you can&apos;t say
      </Text>
      <ProgressLine value={isWorking ? null : 1} label="Working it out" className={cn(!isWorking && 'opacity-0')} />
      {check.length === 0 ? (
        <Text as="p" color="muted" className="content-in">
          Nothing left it isn&apos;t sure about
        </Text>
      ) : (
        <div
          className={cn(
            'content-in flex flex-col transition-opacity duration-(--dur-quick)',
            isWorking && 'opacity-60',
          )}
        >
          {check.map((one) => (
            <CheckRow
              key={one.track.id}
              check={one}
              answer={answers[one.track.id]?.answer ?? null}
              onAnswer={onAnswer}
            />
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-gap">
        <Button variant="outline" size="sm" disabled={answered === 0} onClick={onNextRound}>
          Another round
        </Button>
        <Text variant="meta" color="muted" tabular>
          {answered === 0 ? 'Answer some to ask about more' : `${formatPlural(answered, 'answer')} so far`}
        </Text>
      </div>
    </div>
  );
}
