import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import type { RadioStartFrom } from '@shared/domain';
import type { MoodCard } from '@shared/stations';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { Tooltip } from '@/components/ui/Tooltip';
import { formatPlural } from '@/lib/format';
import { moodCardsQuery } from '@/lib/moodQueries';
import { FannedCovers } from './FannedCovers';
import { MoodTuner } from './MoodTuner';
import { TileStrip } from './TileStrip';

type StartFn = (from: RadioStartFrom) => void;

const SKELETON_TILES = 3;
const TILE = 'w-36 flex-none';

function MoodTile({ card, onStart, onEdit }: { card: MoodCard; onStart: StartFn; onEdit: () => void }) {
  const { id, name, covers, songs } = card;
  return (
    <div className={`relative ${TILE}`}>
      <Button
        variant="card"
        size="card"
        className="w-full text-center"
        aria-label={`Start ${name}`}
        onClick={() => onStart({ kind: 'station', stationId: id })}
      >
        <FannedCovers covers={covers} title={name} />
        <Text truncate>{name}</Text>
        <Text variant="meta" color="muted" tabular truncate>
          {songs === null ? 'Not worked out yet' : formatPlural(songs, 'song')}
        </Text>
      </Button>
      {/* Beside the card rather than in it, so it's a button of its own and always there for a finger. */}
      <Tooltip label="Edit">
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label={`Edit ${name}`}
          className="absolute top-0 right-0 z-20 rounded-full shadow-sleeve"
          onClick={onEdit}
        >
          <Pencil aria-hidden />
        </Button>
      </Tooltip>
    </div>
  );
}

function NewMoodTile({ onCreate }: { onCreate: () => void }) {
  return (
    <Button variant="card" size="card" className={`${TILE} text-center`} onClick={onCreate}>
      <span aria-hidden className="flex h-24 w-full items-center justify-center">
        <span className="flex size-20 items-center justify-center rounded-md border border-dashed border-outline">
          <Plus className="text-text-muted" />
        </span>
      </span>
      <Text truncate>New mood</Text>
      <Text variant="meta" color="muted" truncate>
        From songs like it
      </Text>
    </Button>
  );
}

/** Stations defined by songs that sound like them: tap one to play it, the pen to tune it, or make another. */
export function MoodSection({ onStart }: { onStart: StartFn }) {
  const cards = useQuery(moodCardsQuery);
  const [tuning, setTuning] = useState<{ stationId: number | null } | null>(null);

  function content() {
    if (cards.isPending) {
      return (
        <div aria-hidden className="flex flex-wrap justify-center gap-gap max-sm:flex-nowrap max-sm:justify-start">
          {Array.from({ length: SKELETON_TILES }, (_, index) => (
            <Skeleton key={index} className="h-32 w-36 shrink-0 rounded-md" />
          ))}
        </div>
      );
    }
    if (cards.isError) {
      return <ErrorState error={cards.error} onRetry={() => void cards.refetch()} className="size-auto" />;
    }
    return (
      <>
        <TileStrip>
          {cards.data.map((card) => (
            <MoodTile key={card.id} card={card} onStart={onStart} onEdit={() => setTuning({ stationId: card.id })} />
          ))}
          <NewMoodTile onCreate={() => setTuning({ stationId: null })} />
        </TileStrip>
        {cards.data.length === 0 ? (
          <div className="text-center">
            <Text as="p" variant="meta" color="muted">
              A mood plays what sounds like the songs, albums or artists you give it: study music, a workout, a quiet
              evening
            </Text>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      {content()}
      {tuning === null ? null : (
        <MoodTuner key={tuning.stationId ?? 'new'} stationId={tuning.stationId} onClose={() => setTuning(null)} />
      )}
    </>
  );
}
