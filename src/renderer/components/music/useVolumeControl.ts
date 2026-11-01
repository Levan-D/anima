import { Volume, Volume1, Volume2, type LucideIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import type { PlayerState } from '@shared/domain';
import { setMuted, setVolume } from '@/lib/playerActions';
import { playerState, usePlayer } from '@/lib/playerStore';

// Often enough to hear it follow the finger, and no more: every step is a message to main and one to mpv.
const SEND_EVERY_MS = 50;
const WHEEL_STEP = 5;
const WHEEL_SETTLES_MS = 150;

type Level = 'silent' | 'low' | 'high';

const LEVEL_ICONS: Record<Level, LucideIcon> = { silent: Volume, low: Volume1, high: Volume2 };

function levelOf({ volume }: PlayerState): Level {
  if (volume === 0) return 'silent';
  return volume < 50 ? 'low' : 'high';
}

export function useVolumeIcon(): LucideIcon {
  return LEVEL_ICONS[usePlayer(levelOf)];
}

/** What a volume slider shows and does, for whichever one is on screen. */
export function useVolumeControl() {
  const volume = usePlayer((state) => state.volume);
  // A drag or a held key can outrun the round trip to main, and the next step has to start from the last one.
  const [moved, setMoved] = useState<number | null>(null);
  const lastSentAt = useRef(0);
  const wheelSettles = useRef<ReturnType<typeof setTimeout>>(undefined);
  const value = moved ?? volume;

  function onValueChange(next: number): void {
    setMoved(next);
    // Reaching for the volume means wanting to hear it.
    if (playerState().muted) setMuted(false);
    const now = performance.now();
    if (now - lastSentAt.current < SEND_EVERY_MS) return;
    lastSentAt.current = now;
    void setVolume(next);
  }

  function onValueCommit(next: number): void {
    void setVolume(next).finally(() => setMoved(null));
  }

  function onStep(direction: 1 | -1): void {
    const next = Math.min(Math.max(value + direction * WHEEL_STEP, 0), 100);
    onValueChange(next);
    clearTimeout(wheelSettles.current);
    wheelSettles.current = setTimeout(() => onValueCommit(next), WHEEL_SETTLES_MS);
  }

  return { value, onValueChange, onValueCommit, onStep };
}
