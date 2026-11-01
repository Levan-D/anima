import type { DiscoverArtist } from '@shared/domain';
import { Text } from '@/components/ui/Text';
import { joinParts } from '@/lib/format';
import { becauseWords, countWords } from '../utils/suggestions';
import { ArtStack } from './ArtStack';

type Props = {
  artist: DiscoverArtist;
};

export function SuggestionCard({ artist }: Props) {
  return (
    <article
      data-testid="discover-card"
      title={artist.tracks.join(', ')}
      className="group/card flex w-showcase min-w-0 flex-col gap-gap"
    >
      <ArtStack recommenders={artist.recommendedBy} kind="fan" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <Text as="h3" variant="title" truncate>
          {artist.name}
        </Text>
        <Text as="p" variant="meta" color="muted" truncate>
          {becauseWords(artist)}
        </Text>
        <Text as="p" variant="meta" color="faint" truncate>
          {joinParts(countWords(artist), artist.genres.join(', '))}
        </Text>
      </div>
    </article>
  );
}
