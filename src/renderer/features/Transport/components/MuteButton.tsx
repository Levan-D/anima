import { Volume, Volume1, Volume2, VolumeX, type LucideIcon } from 'lucide-react';
import type { PlayerState } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { goBack } from '@/lib/navigation';
import { setMuted } from '@/lib/playerActions';
import { playerState, usePlayer } from '@/lib/playerStore';

type Level = 'muted' | 'silent' | 'low' | 'high';

const LEVEL_ICONS: Record<Level, LucideIcon> = { muted: VolumeX, silent: Volume, low: Volume1, high: Volume2 };

function levelOf({ volume, muted }: PlayerState): Level {
  if (muted) return 'muted';
  if (volume === 0) return 'silent';
  return volume < 50 ? 'low' : 'high';
}

type Props = {
  className?: string;
};

export function MuteButton({ className }: Props) {
  const level = usePlayer(levelOf);
  const isMuted = level === 'muted';
  const label = isMuted ? 'Unmute' : 'Mute';
  const Icon = LEVEL_ICONS[level];

  return (
    <Tooltip label={label} onEscape={goBack}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        aria-pressed={isMuted}
        onClick={() => setMuted(!playerState().muted)}
        {...(className ? { className } : {})}
      >
        <Icon aria-hidden />
      </Button>
    </Tooltip>
  );
}
