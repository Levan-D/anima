import { Play } from 'lucide-react';
import type { Track } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { playTracks } from '@/lib/playerActions';

type Props = {
  /** In the order they should play. */
  tracks: readonly Track[];
};

export function PlayAllButton({ tracks }: Props) {
  return (
    <Button variant="primary" size="xl" onClick={() => playTracks(tracks)} className="[&_svg]:fill-current">
      <Play aria-hidden />
      Play
    </Button>
  );
}
