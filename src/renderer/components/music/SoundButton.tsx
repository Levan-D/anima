import { VolumeX } from 'lucide-react';
import { useVolumeControl, useVolumeIcon } from '@/components/music/useVolumeControl';
import { HoverSlider } from '@/components/ui/HoverSlider';
import { Slider } from '@/components/ui/Slider';
import { cn } from '@/lib/cn';
import { setMuted } from '@/lib/playerActions';
import { usePlayer } from '@/lib/playerStore';

type Props = {
  /** Which way the bar opens: the mini window has no room above a button. */
  side?: 'top' | 'left';
  className?: string;
};

/** For where there's no room for the slider itself: mutes when pressed, and shows it when hovered, focused or tapped. */
export function SoundButton({ side = 'top', className }: Props) {
  const icon = useVolumeIcon();
  const isMuted = usePlayer((state) => state.muted);
  const { value, onValueChange, onValueCommit, onStep } = useVolumeControl();

  return (
    <HoverSlider
      labelOff="Mute"
      labelOn="Unmute"
      isOn={isMuted}
      onPressedChange={setMuted}
      icon={icon}
      iconOn={VolumeX}
      barLabel="Volume"
      side={side}
      onStep={onStep}
      {...(className ? { className } : {})}
    >
      <Slider
        label="Volume"
        value={value}
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
        className={cn('min-w-0 flex-1', isMuted && 'opacity-50')}
      />
    </HoverSlider>
  );
}
