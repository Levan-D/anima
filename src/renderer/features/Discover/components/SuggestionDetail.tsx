import { useQuery } from '@tanstack/react-query';
import { Fragment } from 'react';
import type { DiscoverArtist, DiscoverKnownTrack } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { Modal } from '@/components/ui/Modal';
import { ModalSection } from '@/components/ui/ModalSection';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { AppFailure } from '@/lib/api';
import { discoverDetailQuery } from '@/lib/libraryQueries';
import { linkedTrackIds, shownVoices } from '../utils/suggestions';
import { OwnedTrackCard } from './OwnedTrackCard';
import { VoiceGroups } from './VoiceGroups';
import { VoiceList } from './VoiceList';

const SONGS_SHOWN = 10;
const FLAT_VOICES_MAX = 16;
const YOURS_SHOWN = 2;
const LOADING_ROWS = 4;
const CANT_LOAD = "Couldn't load this";

type SongRowProps = {
  track: DiscoverKnownTrack;
  onLeave: () => void;
};

function SongRow({ track: { title, ledBy }, onLeave }: SongRowProps) {
  const yours = ledBy.slice(0, YOURS_SHOWN);

  return (
    <li className="group/song relative flex items-baseline justify-between gap-x-gap px-section py-2">
      <Divider className="absolute inset-x-0 top-0 group-first/song:hidden" />
      <Text truncate className="min-w-0">
        {title}
      </Text>
      {yours.length > 0 ? (
        <span className="flex min-w-0 items-baseline gap-1">
          <Text variant="meta" color="muted" className="shrink-0">
            If you like
          </Text>
          {yours.map(({ trackId, artistId, title: from }, index) => (
            <Fragment key={trackId}>
              {index > 0 ? (
                <Text variant="meta" color="muted" className="shrink-0">
                  and
                </Text>
              ) : null}
              <OwnedTrackCard trackId={trackId} artistId={artistId} title={from} onLeave={onLeave} />
            </Fragment>
          ))}
        </span>
      ) : null}
    </li>
  );
}

type EvidenceProps = {
  artistKey: string;
  onLeave: () => void;
};

function Evidence({ artistKey, onLeave }: EvidenceProps) {
  const detail = useQuery(discoverDetailQuery(artistKey));

  if (detail.isPending) {
    return (
      <div aria-busy className="-mx-section flex animate-appear-late flex-col py-section">
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

  const { tracks } = detail.data;
  const voices = shownVoices(detail.data.voices);
  const linkedTracks = linkedTrackIds(tracks);
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
          {voices.length > FLAT_VOICES_MAX ? (
            <VoiceGroups voices={voices} linkedTracks={linkedTracks} />
          ) : (
            <VoiceList voices={voices} linkedTracks={linkedTracks} showsStrength className="-mx-section" />
          )}
        </ModalSection>
      ) : null}
      {tracks.length > 0 ? (
        <ModalSection title="Songs to start with">
          <Text as="p" color="muted">
            Their songs that fans of your music also play
          </Text>
          <ul className="-mx-section flex flex-col">
            {tracks.slice(0, SONGS_SHOWN).map((track) => (
              <SongRow key={track.title} track={track} onLeave={onLeave} />
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
        <Evidence artistKey={artist.key} onLeave={() => onOpenChange(false)} />
      </div>
    </Modal>
  );
}
