import { PictureInPicture2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { goBack } from '@/lib/navigation';
import { setMiniPlayer } from '@/lib/windowActions';

type Props = {
  className?: string;
};

/** For a finger or a mouse, as Ctrl+M is for the keyboard. */
export function MiniPlayerButton({ className }: Props) {
  return (
    <Tooltip label="Mini player: swaps this window for a small strip with just the controls" onEscape={goBack}>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Mini player"
        className={className}
        onClick={() => setMiniPlayer(true)}
      >
        <PictureInPicture2 aria-hidden />
      </Button>
    </Tooltip>
  );
}
