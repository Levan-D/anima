import { Play } from 'lucide-react';
import type { QueueFrom, Track } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { playTracks } from '@/lib/playerActions';

type Props = {
  /** In the order they should play. */
  tracks: readonly Track[];
  /** Where they are, for the transport to lead back to. */
  from?: QueueFrom | null;
};

export function PlayAllButton({ tracks, from = null }: Props) {
  return (
    <Button variant="primary" onClick={() => playTracks(tracks, tracks[0], from)} className="[&_svg]:fill-current">
      <Play aria-hidden />
      Play
    </Button>
  );
}
