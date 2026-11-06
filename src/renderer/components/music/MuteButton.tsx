import { VolumeX } from 'lucide-react';
import { useVolumeIcon } from '@/components/music/useVolumeControl';
import { IconToggle } from '@/components/ui/IconToggle';
import { goBack } from '@/lib/navigation';
import { setMuted } from '@/lib/playerActions';
import { usePlayer } from '@/lib/playerStore';

type Props = {
  className?: string;
};

export function MuteButton({ className }: Props) {
  const icon = useVolumeIcon();
  const isMuted = usePlayer((state) => state.muted);

  return (
    <IconToggle
      labelOff="Mute"
      labelOn="Unmute"
      isOn={isMuted}
      onPressedChange={setMuted}
      icon={icon}
      iconOn={VolumeX}
      onEscape={goBack}
      {...(className ? { className } : {})}
    />
  );
}
