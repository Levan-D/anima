import { PictureInPicture2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { setMiniPlayer } from '@/lib/windowActions';

type Props = {
  className?: string;
};

/** For a finger or a mouse, as Ctrl+M is for the keyboard. */
export function MiniPlayerButton({ className }: Props) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Mini player"
      title="Mini player"
      className={className}
      onClick={() => setMiniPlayer(true)}
    >
      <PictureInPicture2 aria-hidden />
    </Button>
  );
}
