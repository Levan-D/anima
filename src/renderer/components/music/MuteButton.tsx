import { Volume, Volume1, Volume2, VolumeX, type LucideIcon } from 'lucide-react';
import type { PlayerState } from '@shared/domain';
import { IconToggle } from '@/components/ui/IconToggle';
import { goBack } from '@/lib/navigation';
import { setMuted } from '@/lib/playerActions';
import { usePlayer } from '@/lib/playerStore';

type Level = 'silent' | 'low' | 'high';

const LEVEL_ICONS: Record<Level, LucideIcon> = { silent: Volume, low: Volume1, high: Volume2 };

function levelOf({ volume }: PlayerState): Level {
  if (volume === 0) return 'silent';
  return volume < 50 ? 'low' : 'high';
}

type Props = {
  onEscape?: () => void;
  tooltipSide?: 'top' | 'left';
  className?: string;
};

export function MuteButton({ onEscape = goBack, tooltipSide = 'top', className }: Props) {
  const level = usePlayer(levelOf);
  const isMuted = usePlayer((state) => state.muted);

  return (
    <IconToggle
      labelOff="Mute"
      labelOn="Unmute"
      isOn={isMuted}
      onPressedChange={setMuted}
      icon={LEVEL_ICONS[level]}
      iconOn={VolumeX}
      onEscape={onEscape}
      tooltipSide={tooltipSide}
      {...(className ? { className } : {})}
    />
  );
}
