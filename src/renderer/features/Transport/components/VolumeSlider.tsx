import { useVolumeControl } from '@/components/music/useVolumeControl';
import { Slider } from '@/components/ui/Slider';
import { cn } from '@/lib/cn';
import { usePlayer } from '@/lib/playerStore';

type Props = {
  className?: string;
};

export function VolumeSlider({ className }: Props) {
  const muted = usePlayer((state) => state.muted);
  const { value, onValueChange, onValueCommit } = useVolumeControl();

  return (
    <Slider
      label="Volume"
      value={value}
      onValueChange={onValueChange}
      onValueCommit={onValueCommit}
      className={cn('min-w-0', muted && 'opacity-50', className)}
    />
  );
}
