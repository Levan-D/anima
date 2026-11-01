import { useMemo, type CSSProperties } from 'react';
import { washFrom } from '@/lib/albumAccent';
import { cn } from '@/lib/cn';
import { usePlayer } from '@/lib/playerStore';

type Props = {
  /** 0 to 1: how much of the colors comes through. */
  intensity: number;
  /** Moves slowly while music plays. Otherwise it stays where it is. */
  drifts?: boolean;
  /** Where it goes. It sits behind its stacking context's content, so that needs to be `isolate`d if it has a background. */
  className?: string;
};

/** Soft colors from the album that's playing, easing to the next one, and nothing with nothing playing. The rest is `.wash` in globals.css. */
export function AlbumBackdrop({ intensity, drifts = false, className }: Props) {
  const artColor = usePlayer((state) => state.current?.artColor ?? null);
  const isPlaying = usePlayer((state) => state.status === 'playing');
  const wash = useMemo(() => washFrom(artColor), [artColor]);
  if (wash === null) return null;

  const [a, b, c] = wash;
  const style = { '--wash-a': a, '--wash-b': b, '--wash-c': c, opacity: intensity } as CSSProperties;

  return (
    <div
      aria-hidden
      data-testid="album-backdrop"
      data-still={drifts && isPlaying ? undefined : true}
      style={style}
      className={cn(
        'wash pointer-events-none -z-10 overflow-hidden transition-[--wash-a,--wash-b,--wash-c] duration-(--dur-loop) ease-standard',
        className,
      )}
    >
      <div className="wash-blob" />
      <div className="wash-blob" />
      <div className="wash-blob" />
    </div>
  );
}
