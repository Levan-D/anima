import { memo } from 'react';
import type { GenreSummary } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { formatCount } from '@/lib/format';

type Props = {
  genre: GenreSummary;
  onOpen: (genreId: number) => void;
};

export const GenreRow = memo(function GenreRow({ genre, onOpen }: Props) {
  return (
    <Button variant="row" size="row" tabIndex={-1} data-testid="list-row" onClick={() => onOpen(genre.id)}>
      <Text truncate className="min-w-0 flex-1">
        {genre.name}
      </Text>
      <Text variant="meta" color="muted" tabular className="shrink-0">
        {formatCount(genre.trackCount)}
      </Text>
    </Button>
  );
});
