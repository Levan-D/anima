import type { DiscoverDetail } from '@shared/domain';
import { AlbumArt } from '@/components/music/AlbumArt';
import { PlayingBars } from '@/components/music/PlayingBars';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { Text } from '@/components/ui/Text';
import { Tooltip } from '@/components/ui/Tooltip';
import { tracksQuery } from '@/lib/libraryQueries';
import { playTracks } from '@/lib/playerActions';
import { usePlayer } from '@/lib/playerStore';
import { pressMeansPlay } from '@/lib/press';
import { queryClient } from '@/lib/queryClient';
import { showToast } from '@/lib/toastStore';
import { strengthWords } from '@/features/Discover/utils/suggestions';

type Voice = DiscoverDetail['voices'][number];

/** The queue becomes the artist's tracks, from the one that leads to this suggestion when there is one. */
async function playVoice(artistId: number, linkedTrackId: number | null): Promise<void> {
  try {
    const tracks = await queryClient.fetchQuery(tracksQuery({ kind: 'artist', artistId }));
    if (tracks.length === 0) {
      showToast({ message: 'Nothing of theirs to play', level: 'warning' });
      return;
    }
    playTracks(tracks, tracks.find(({ id }) => id === linkedTrackId) ?? tracks[0]);
  } catch {
    showToast({ message: "Couldn't load their tracks", level: 'error' });
  }
}

type RowProps = {
  voice: Voice;
  linkedTrackId: number | null;
  showsStrength: boolean;
};

function VoiceRow({ voice: { artistId, name, artHash, score }, linkedTrackId, showsStrength }: RowProps) {
  const isCurrent = usePlayer((state) => state.current?.artistId === artistId);

  return (
    <li className="group/voice relative h-row">
      <Tooltip label="Double click to play">
        <Button
          variant="row"
          size="row"
          aria-current={isCurrent || undefined}
          className="px-section"
          onClick={(event) => {
            if (pressMeansPlay(event)) void playVoice(artistId, linkedTrackId);
          }}
        >
          <AlbumArt hash={artHash} title={name} className="size-10 shrink-0" />
          <Text truncate color={isCurrent ? 'accent' : 'default'} className="min-w-0 flex-1">
            {name}
          </Text>
          {isCurrent ? <PlayingBars /> : null}
          {showsStrength ? (
            <Text variant="meta" color="muted" className="shrink-0">
              {strengthWords(score)}
            </Text>
          ) : null}
        </Button>
      </Tooltip>
      <Divider className="absolute inset-x-0 top-0 group-first/voice:hidden" />
    </li>
  );
}

type Props = {
  voices: DiscoverDetail['voices'];
  /** Each artist's track that leads to this suggestion, by artist id. */
  linkedTracks: ReadonlyMap<number, number>;
  showsStrength?: boolean;
  className?: string;
};

/** Plain rows and no virtualizer: 16 at most on its own, and the biggest group across the real library is 75. */
export function VoiceList({ voices, linkedTracks, showsStrength = false, className }: Props) {
  return (
    <ul className={className}>
      {voices.map((voice) => (
        <VoiceRow
          key={voice.artistId}
          voice={voice}
          linkedTrackId={linkedTracks.get(voice.artistId) ?? null}
          showsStrength={showsStrength}
        />
      ))}
    </ul>
  );
}
