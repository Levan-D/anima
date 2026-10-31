import { useMemo, useRef } from 'react';
import type { EqBand } from '@shared/domain';
import { Text } from '@/components/ui/Text';
import { BandNode } from '@/features/Equalizer/components/BandNode';
import { curvePath, xOfHz, yOfGain } from '@/features/Equalizer/utils/eqBands';
import { cn } from '@/lib/cn';

const HZ_MARKS = [
  { hz: 100, words: '100' },
  { hz: 1000, words: '1k' },
  { hz: 10_000, words: '10k' },
];
const GAIN_MARKS = [
  { gainDb: 12, words: '+12' },
  { gainDb: 0, words: '0 dB' },
  { gainDb: -12, words: '−12' },
];

const VIEW = 1000;

type MarkProps = {
  words: string;
  x: number;
  y: number;
};

function Mark({ words, x, y }: MarkProps) {
  const left = `${x * 100}%`;
  const top = `${y * 100}%`;
  return (
    <span className="pointer-events-none absolute" style={{ left, top }}>
      <Text variant="meta" color="faint" tabular>
        {words}
      </Text>
    </span>
  );
}

type Props = {
  bands: readonly EqBand[];
  isOn: boolean;
  /** Said in the middle of the plot when there's nothing on it yet. */
  hint: string | null;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onChange: (band: EqBand) => void;
  className?: string;
};

export function ResponseCurve({ bands, isOn, hint, selectedId, onSelect, onChange, className }: Props) {
  const plot = useRef<HTMLDivElement>(null);
  const line = useMemo(() => curvePath(bands), [bands]);
  const fill = `${line}L${VIEW} ${VIEW / 2}L0 ${VIEW / 2}Z`;

  return (
    <div ref={plot} data-testid="eq-plot" className={cn('relative touch-none select-none', className)}>
      <svg
        aria-hidden
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        preserveAspectRatio="none"
        className={cn('absolute inset-0 size-full overflow-visible', !isOn && 'opacity-40')}
      >
        {HZ_MARKS.map(({ hz }) => (
          <line
            key={hz}
            x1={xOfHz(hz) * VIEW}
            x2={xOfHz(hz) * VIEW}
            y1={0}
            y2={VIEW}
            vectorEffect="non-scaling-stroke"
            className="stroke-border"
          />
        ))}
        {GAIN_MARKS.map(({ gainDb }) => (
          <line
            key={gainDb}
            x1={0}
            x2={VIEW}
            y1={yOfGain(gainDb) * VIEW}
            y2={yOfGain(gainDb) * VIEW}
            vectorEffect="non-scaling-stroke"
            className={gainDb === 0 ? 'stroke-text-faint' : 'stroke-border'}
          />
        ))}
        <path d={fill} className="fill-accent opacity-15" />
        <path
          data-testid="eq-curve"
          d={line}
          vectorEffect="non-scaling-stroke"
          className="fill-none stroke-accent [stroke-width:var(--focus-width)]"
        />
      </svg>

      {HZ_MARKS.map(({ hz, words }) => (
        <Mark key={hz} words={words} x={xOfHz(hz)} y={1} />
      ))}
      {GAIN_MARKS.map(({ gainDb, words }) => (
        <Mark key={gainDb} words={words} x={0} y={yOfGain(gainDb)} />
      ))}

      {hint === null ? null : (
        <div className="pointer-events-none absolute inset-x-0 top-1/4 flex justify-center px-gutter">
          <Text variant="body" color="muted">
            {hint}
          </Text>
        </div>
      )}

      {bands.map((band, index) => (
        <BandNode
          key={band.id}
          bands={bands}
          band={band}
          number={index + 1}
          isSelected={band.id === selectedId}
          plot={plot}
          onSelect={() => onSelect(band.id)}
          onChange={onChange}
        />
      ))}
    </div>
  );
}
