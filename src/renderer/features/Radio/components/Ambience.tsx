import { useMemo, useRef, type RefObject } from 'react';
import { AlbumBackdrop } from '@/components/music/AlbumBackdrop';
import { washFrom } from '@/lib/albumAccent';
import { usePlayer } from '@/lib/playerStore';
import { LAVA_HEIGHT, LAVA_WIDTH, useLavaLamp } from '@/features/Radio/hooks/useLavaLamp';
import { useMusicMotion } from '@/features/Radio/hooks/useMusicMotion';

type LavaProps = {
  canvas: RefObject<HTMLCanvasElement | null>;
  loud: RefObject<number>;
};

function Lava({ canvas, loud }: LavaProps) {
  const artColor = usePlayer((state) => state.current?.artColor ?? null);
  const isPlaying = usePlayer((state) => state.status === 'playing');
  const wash = useMemo(() => washFrom(artColor), [artColor]);
  useLavaLamp(canvas, loud, wash, isPlaying);
  return <canvas ref={canvas} width={LAVA_WIDTH} height={LAVA_HEIGHT} className="ambience-lava" />;
}

/** Behind the Radio page: the album's colours swelling slowly with the music, and a lava lamp in them. */
export function Ambience() {
  const breathe = useRef<HTMLDivElement>(null);
  const lava = useRef<HTMLCanvasElement>(null);
  const loud = useRef(0);
  useMusicMotion({ breathe, lava, loudRef: loud });

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div ref={breathe} className="ambience-breathe absolute inset-0">
        <AlbumBackdrop intensity={1} drifts className="absolute inset-0" />
      </div>
      <Lava canvas={lava} loud={loud} />
    </div>
  );
}
