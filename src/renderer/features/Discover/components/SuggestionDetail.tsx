import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { DiscoverArtist, DiscoverKnownTrack } from '@shared/domain';
import { AlbumArt } from '@/components/music/AlbumArt';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ModalSection } from '@/components/ui/ModalSection';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { AppFailure } from '@/lib/api';
import { discoverDetailQuery } from '@/lib/libraryQueries';
import { openArtist } from '@/lib/navigation';
import { strengthWords } from '../utils/suggestions';

const LED_BY_SHOWN = 3;
const LOADING_ROWS = 4;
const CANT_LOAD = "Couldn't load this";

type KnownTrackProps = {
  track: DiscoverKnownTrack;
};

function KnownTrack({ track: { title, ledBy } }: KnownTrackProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const shown = isExpanded ? ledBy : ledBy.slice(0, LED_BY_SHOWN);
  const hidden = ledBy.length - shown.length;

  return (
    <li className="flex flex-col gap-0.5">
      <Text as="p">{title}</Text>
      <Text as="p" variant="meta" color="muted">
        {`From your ${shown.map((from) => `${from.title} (${from.artist})`).join(' · ')}`}
      </Text>
      {hidden > 0 ? (
        <Button variant="outline" size="sm" onClick={() => setIsExpanded(true)} className="mt-1 self-start">
          {`Show ${hidden} more`}
        </Button>
      ) : null}
    </li>
  );
}

type EvidenceProps = {
  artistKey: string;
  onOpenArtist: (artistId: number) => void;
};

function Evidence({ artistKey, onOpenArtist }: EvidenceProps) {
  const detail = useQuery(discoverDetailQuery(artistKey));

  if (detail.isPending) {
    return (
      <div aria-busy className="flex flex-col gap-2 py-section">
        {Array.from({ length: LOADING_ROWS }, (_, index) => (
          <Skeleton key={index} className="h-tap w-full" />
        ))}
      </div>
    );
  }
  if (detail.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-gap py-section">
        <Text as="p" color="muted">
          {detail.error instanceof AppFailure ? detail.error.message : CANT_LOAD}
        </Text>
        <Button variant="outline" size="md" onClick={() => void detail.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const { voices, tracks } = detail.data;
  if (voices.length === 0 && tracks.length === 0) {
    return (
      <Text as="p" color="muted" className="py-section">
        Nothing links this to your music any more
      </Text>
    );
  }

  return (
    <>
      {voices.length > 0 ? (
        <ModalSection title="Why">
          <Text as="p" color="muted">
            {voices.length === 1
              ? 'Listeners of this artist of yours also listen to it'
              : `Listeners of these ${voices.length} artists of yours also listen to it, strongest first`}
          </Text>
          <ul className="flex flex-col gap-2">
            {voices.map(({ artistId, name, artHash, score }) => (
              <li key={artistId}>
                <Button
                  variant="outline"
                  size="bare"
                  onClick={() => onOpenArtist(artistId)}
                  className="w-full justify-start p-1.5 text-left [&>span]:w-full [&>span]:min-w-0 [&>span]:justify-start [&>span]:gap-gap"
                >
                  <AlbumArt hash={artHash} title={name} className="size-12 shrink-0" />
                  <Text truncate className="min-w-0 flex-1">
                    {name}
                  </Text>
                  <Text variant="meta" color="muted" className="shrink-0 pr-1">
                    {strengthWords(score)}
                  </Text>
                </Button>
              </li>
            ))}
          </ul>
        </ModalSection>
      ) : null}
      {tracks.length > 0 ? (
        <ModalSection title="Its tracks close to yours">
          <Text as="p" color="muted">
            You don't own these, so nothing plays
          </Text>
          <ul className="flex flex-col gap-3">
            {tracks.map((track) => (
              <KnownTrack key={track.title} track={track} />
            ))}
          </ul>
        </ModalSection>
      ) : null}
    </>
  );
}

type Props = {
  artist: DiscoverArtist;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** All that's held on a suggestion, which is only ever what listeners of owned music say. There's no bio or art to show. */
export function SuggestionDetail({ artist, open, onOpenChange }: Props) {
  const description =
    artist.genres.length > 0
      ? `${artist.genres.join(', ')} · inferred from who recommends it`
      : "No genre to infer: the artists recommending it aren't tagged";

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={artist.name}
      description={description}
      closeLabel="Close"
      size="lg"
      className="h-auto w-200"
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-section">
        <Evidence
          artistKey={artist.key}
          onOpenArtist={(artistId) => {
            onOpenChange(false);
            openArtist(artistId);
          }}
        />
      </div>
    </Modal>
  );
}
