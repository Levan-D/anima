import { useRef, useState } from 'react';
import { Slider } from '@/components/ui/Slider';
import { cn } from '@/lib/cn';
import { setMuted, setVolume } from '@/lib/playerActions';
import { playerState, usePlayer } from '@/lib/playerStore';

// Often enough to hear it follow the finger, and no more: every step is a message to main and one to mpv.
const SEND_EVERY_MS = 50;

type Props = {
  className?: string;
};

export function VolumeSlider({ className }: Props) {
  const volume = usePlayer((state) => state.volume);
  const muted = usePlayer((state) => state.muted);
  // A drag or a held key can outrun the round trip to main, and the next step has to start from the last one.
  const [moved, setMoved] = useState<number | null>(null);
  const lastSentAt = useRef(0);

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

  return (
    <Slider
      label="Volume"
      value={moved ?? volume}
      onValueChange={onValueChange}
      onValueCommit={onValueCommit}
      className={cn('min-w-0', muted && 'opacity-50', className)}
    />
  );
}
