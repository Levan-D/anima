import type { DiscoverArtist } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { joinParts } from '@/lib/format';
import { becauseWords, countWords } from '../utils/suggestions';
import { ArtStack } from './ArtStack';

type Props = {
  artist: DiscoverArtist;
  onOpen: (artist: DiscoverArtist) => void;
};

export function SuggestionCard({ artist, onOpen }: Props) {
  return (
    <Button
      variant="card"
      size="card"
      tabIndex={-1}
      data-testid="discover-card"
      aria-haspopup="dialog"
      title={artist.tracks.join(', ')}
      onClick={() => onOpen(artist)}
      className="group/card w-showcase flex-none [&>span]:gap-gap"
    >
      <ArtStack recommenders={artist.recommendedBy} kind="fan" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <Text variant="title" truncate>
          {artist.name}
        </Text>
        <Text variant="meta" color="muted" truncate>
          {becauseWords(artist)}
        </Text>
        <Text variant="meta" color="faint" truncate>
          {joinParts(countWords(artist), artist.genres.join(', '))}
        </Text>
      </span>
    </Button>
  );
}
