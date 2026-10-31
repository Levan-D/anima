import { AudioLines } from 'lucide-react';
import { isEqAudible } from '@shared/eqCurve';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { toggleEqualizer, useEqualizerDialog } from '@/lib/equalizerDialog';
import { usePlayer } from '@/lib/playerStore';

type Props = {
  className?: string;
};

/** For a finger or a mouse, as E is for the keyboard. In the accent while the EQ is changing the sound. */
export function EqButton({ className }: Props) {
  const isOpen = useEqualizerDialog();
  const isChanging = usePlayer((state) => isEqAudible(state.eq));

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Equalizer"
      aria-pressed={isOpen}
      className={cn(isChanging && 'text-accent', className)}
      onClick={toggleEqualizer}
    >
      <AudioLines aria-hidden />
    </Button>
  );
}
