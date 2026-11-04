import { useMemo, useRef, type RefObject } from 'react';
import { AlbumBackdrop } from '@/components/music/AlbumBackdrop';
import { washFrom } from '@/lib/albumAccent';
import { usePlayer } from '@/lib/playerStore';
import { LAVA_HEIGHT, LAVA_WIDTH, useLavaLamp } from '../hooks/useLavaLamp';
import { useMusicMotion } from '../hooks/useMusicMotion';

function Lava({ ambience }: { ambience: RefObject<HTMLDivElement | null> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const artColor = usePlayer((state) => state.current?.artColor ?? null);
  const isPlaying = usePlayer((state) => state.status === 'playing');
  const wash = useMemo(() => washFrom(artColor), [artColor]);
  useLavaLamp(canvas, ambience, wash, isPlaying);
  return <canvas ref={canvas} width={LAVA_WIDTH} height={LAVA_HEIGHT} className="ambience-lava" />;
}

/** Behind the Radio page: the album's colours swelling slowly with the music, and a lava lamp in them. */
export function Ambience() {
  const ref = useRef<HTMLDivElement>(null);
  useMusicMotion(ref);

  return (
    <div ref={ref} aria-hidden className="ambience pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="ambience-breathe absolute inset-0">
        <AlbumBackdrop intensity={1} drifts className="absolute inset-0" />
      </div>
      <Lava ambience={ref} />
    </div>
  );
}
