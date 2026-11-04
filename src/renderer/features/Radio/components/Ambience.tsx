import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { AlbumBackdrop } from '@/components/music/AlbumBackdrop';
import { PillGroup } from '@/components/ui/PillGroup';
import { cn } from '@/lib/cn';
import { useMusicMotion } from '../hooks/useMusicMotion';

type Layer = 'breathe' | 'grooves' | 'horizon' | 'dust';

// TEMP: a picker for trying the layers together, until Levan settles on which stay.
const LAYERS: readonly { value: Layer; label: string }[] = [
  { value: 'breathe', label: 'Breathing' },
  { value: 'grooves', label: 'Grooves' },
  { value: 'horizon', label: 'Horizon' },
  { value: 'dust', label: 'Dust' },
];

const GROOVES = 37;
const SPECKS = 36;
const HORIZON_POINTS = 160;

/** The same scatter every time, so the dust doesn't rearrange itself between visits. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

const specks = (() => {
  const random = seeded(7);
  return Array.from({ length: SPECKS }, () => ({
    '--x': `${(random() * 100).toFixed(1)}%`,
    '--y': `${(random() * 100).toFixed(1)}%`,
    '--size': `${(1 + random() * 3).toFixed(2)}vmin`,
    '--phase': (random() * 6.28).toFixed(2),
    '--speed': (0.02 + random() * 0.05).toFixed(3),
  })) as CSSProperties[];
})();

/** Long runs with the odd break, each groove its own, so the turning can be seen. */
const grooves = Array.from({ length: GROOVES }, (_, index) => ({
  r: 12 + index,
  dashes: `${20 + ((index * 13) % 40)} ${1 + ((index * 7) % 3)}`,
  style: { '--groove': (0.03 + ((index * 5) % 4) * 0.015).toFixed(3) } as CSSProperties,
}));

function Grooves() {
  return (
    <div className="ambience-record">
      <svg aria-hidden viewBox="0 0 100 100" className="ambience-grooves">
        {grooves.map(({ r, dashes, style }) => (
          <circle key={r} cx="50" cy="50" r={r} pathLength={100} strokeDasharray={dashes} style={style} />
        ))}
      </svg>
      <div className="ambience-sheen" />
      <svg aria-hidden viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="12" className="ambience-ripple" />
      </svg>
    </div>
  );
}

/** The song's shape as a far-off ridge, brighter over what's been played. */
function Horizon({ peaks }: { peaks: Uint8Array }) {
  const path = useMemo(() => {
    const step = peaks.length / HORIZON_POINTS;
    const heights = Array.from({ length: HORIZON_POINTS }, (_, point) => {
      let most = 0;
      for (let i = Math.floor(point * step); i < Math.floor((point + 1) * step); i++)
        most = Math.max(most, peaks[i] ?? 0);
      return most / 255;
    });
    const ridge = heights.map((height, point) => `L${point} ${(100 - height * 70).toFixed(1)}`).join(' ');
    return `M0 100 ${ridge} L${HORIZON_POINTS - 1} 100 Z`;
  }, [peaks]);

  return (
    <div className="ambience-horizon">
      <svg aria-hidden viewBox={`0 0 ${HORIZON_POINTS - 1} 100`} preserveAspectRatio="none">
        <path d={path} />
      </svg>
      <svg aria-hidden viewBox={`0 0 ${HORIZON_POINTS - 1} 100`} preserveAspectRatio="none" className="ambience-played">
        <path d={path} />
      </svg>
      <div className="ambience-glow" />
    </div>
  );
}

/** What moves behind the Radio page: the album's colors and whichever layers are on, following the song slowly. */
export function Ambience() {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<readonly string[]>(LAYERS.map(({ value }) => value));
  const waveform = useMusicMotion(ref);
  const isOn = (layer: Layer) => shown.includes(layer);

  return (
    <>
      <div ref={ref} aria-hidden className="ambience pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className={cn('absolute inset-0', isOn('breathe') && 'ambience-breathe')}>
          <AlbumBackdrop intensity={1} drifts className="absolute inset-0" />
        </div>
        {isOn('grooves') ? <Grooves /> : null}
        {isOn('horizon') && waveform !== null ? <Horizon peaks={waveform.peaks} /> : null}
        {isOn('dust')
          ? specks.map((style, index) => <div key={index} style={style} className="ambience-speck" />)
          : null}
      </div>
      <PillGroup
        label="Background layers"
        items={LAYERS}
        value={shown}
        onValueChange={setShown}
        wraps
        className="absolute top-2 left-gutter z-10"
      />
    </>
  );
}
