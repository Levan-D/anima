import { memo } from 'react';
import type { DiscoverArtist } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { joinParts } from '@/lib/format';
import { becauseWords, countWords } from '../utils/suggestions';
import { ArtStack } from './ArtStack';

type Props = {
  artist: DiscoverArtist;
  compact: boolean;
};

/**
 * A name to go and look for: it isn't in the library, so there's nothing to do with one here. It's a button only because
 * that's what a list's keyboard lands on, which is how this gets read from the couch.
 */
export const SuggestionRow = memo(function SuggestionRow({ artist, compact }: Props) {
  const because = becauseWords(artist);
  const facts = joinParts(countWords(artist), artist.genres.join(', '));

  return (
    <Button
      variant="row"
      size="row"
      tabIndex={-1}
      data-testid="discover-row"
      title={joinParts(because, facts, artist.tracks.join(', '))}
      className="w-auto min-w-0 flex-1 basis-0 rounded-md px-2"
    >
      <ArtStack recommenders={artist.recommendedBy} kind={compact ? 'compact' : 'row'} />
      <span className="flex min-w-0 flex-1 flex-col">
        <Text variant={compact ? 'body' : 'lead'} truncate>
          {artist.name}
        </Text>
        <Text variant="meta" color="muted" truncate>
          {because}
        </Text>
        {compact ? null : (
          <Text variant="meta" color="faint" truncate>
            {facts}
          </Text>
        )}
      </span>
    </Button>
  );
});
