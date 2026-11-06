import { memo } from 'react';
import type { PlaylistSummary } from '@shared/domain';
import { PlaylistCover } from '@/components/music/PlaylistCover';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { playlistMeta } from '@/lib/format';

type Props = {
  playlist: PlaylistSummary;
  onOpen: (playlistId: number) => void;
};

export const PlaylistRow = memo(function PlaylistRow({ playlist, onOpen }: Props) {
  const { id, name, covers } = playlist;
  return (
    <Button variant="row" size="row" tabIndex={-1} data-testid="list-row" onClick={() => onOpen(id)}>
      <PlaylistCover covers={covers} title={name} className="size-11 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col">
        <Text truncate>{name}</Text>
        <Text variant="meta" color="muted" tabular truncate>
          {playlistMeta(playlist)}
        </Text>
      </span>
    </Button>
  );
});
