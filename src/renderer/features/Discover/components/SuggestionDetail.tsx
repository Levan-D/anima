import { useQuery } from '@tanstack/react-query';
import { useRef, type RefObject } from 'react';
import type { DiscoverArtist, DiscoverKnownTrack } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { Modal } from '@/components/ui/Modal';
import { ModalSection } from '@/components/ui/ModalSection';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { AppFailure } from '@/lib/api';
import { discoverDetailQuery } from '@/lib/libraryQueries';
import { openArtist } from '@/lib/navigation';
import { VoiceList } from './VoiceList';

const SONGS_SHOWN = 10;
const YOURS_SHOWN = 2;
const LOADING_ROWS = 4;
const CANT_LOAD = "Couldn't load this";

type SongRowProps = {
  track: DiscoverKnownTrack;
};

function SongRow({ track: { title, ledBy } }: SongRowProps) {
  const yours = ledBy.slice(0, YOURS_SHOWN).map((from) => from.title);

  return (
    <li className="group/song relative flex flex-wrap items-baseline justify-between gap-x-gap px-section py-2">
      <Divider className="absolute inset-x-0 top-0 group-first/song:hidden" />
      <Text className="min-w-0">{title}</Text>
      {yours.length > 0 ? (
        <Text variant="meta" color="muted" className="min-w-0">
          {`If you like ${yours.join(' and ')}`}
        </Text>
      ) : null}
    </li>
  );
}

type EvidenceProps = {
  artistKey: string;
  scrollerRef: RefObject<HTMLDivElement | null>;
  onOpenArtist: (artistId: number) => void;
};

function Evidence({ artistKey, scrollerRef, onOpenArtist }: EvidenceProps) {
  const detail = useQuery(discoverDetailQuery(artistKey));

  if (detail.isPending) {
    return (
      <div aria-busy className="-mx-section flex flex-col py-section">
        {Array.from({ length: LOADING_ROWS }, (_, index) => (
          <div key={index} className="relative flex h-row items-center gap-gap px-section">
            {index > 0 ? <Divider className="absolute inset-x-0 top-0" /> : null}
            <Skeleton className="size-10 shrink-0" />
            <Skeleton className="h-4 min-w-0 flex-1" />
            <Skeleton className="h-3 w-20 shrink-0" />
          </div>
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
          <VoiceList voices={voices} scrollerRef={scrollerRef} onOpenArtist={onOpenArtist} />
        </ModalSection>
      ) : null}
      {tracks.length > 0 ? (
        <ModalSection title="Songs to start with">
          <Text as="p" color="muted">
            Their songs that fans of your music also play
          </Text>
          <ul className="-mx-section flex flex-col">
            {tracks.slice(0, SONGS_SHOWN).map((track) => (
              <SongRow key={track.title} track={track} />
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
  const scrollerRef = useRef<HTMLDivElement>(null);
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
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-section [overflow-anchor:none]">
        <Evidence
          artistKey={artist.key}
          scrollerRef={scrollerRef}
          onOpenArtist={(artistId) => {
            onOpenChange(false);
            openArtist(artistId);
          }}
        />
      </div>
    </Modal>
  );
}
