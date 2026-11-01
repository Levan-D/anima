import { AudioLines } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/lib/cn';
import { toggleEqualizer, useEqualizerDialog } from '@/lib/equalizerDialog';
import { goBack } from '@/lib/navigation';
import { usePlayer } from '@/lib/playerStore';

type Props = {
  className?: string;
};

/** For a finger or a mouse, as E is for the keyboard. On shows in the icon's own color, even while the pointer's over it. */
export function EqButton({ className }: Props) {
  const isOpen = useEqualizerDialog();
  const isOn = usePlayer((state) => state.eq.enabled);

  return (
    <Tooltip label={isOn ? 'Equalizer is on' : 'Equalizer is off'} onEscape={goBack}>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Equalizer"
        aria-pressed={isOpen}
        className={cn(isOn && 'text-accent hover:text-accent', className)}
        onClick={toggleEqualizer}
      >
        <AudioLines aria-hidden />
      </Button>
    </Tooltip>
  );
}
