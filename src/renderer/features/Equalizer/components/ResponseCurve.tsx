import { useMemo, useRef, type MouseEvent, type ReactNode } from 'react';
import type { EqBand } from '@shared/domain';
import { Fade } from '@/components/ui/Fade';
import { Text } from '@/components/ui/Text';
import { BandNode } from '@/features/Equalizer/components/BandNode';
import { EarContours } from '@/features/Equalizer/components/EarContours';
import { PlotBackdrop } from '@/features/Equalizer/components/PlotBackdrop';
import { SoundWords } from '@/features/Equalizer/components/SoundWords';
import { useNodeWheel } from '@/features/Equalizer/hooks/useNodeWheel';
import type { HzRange } from '@/features/Equalizer/utils/chartData';
import { bandNumbers, curveEndX, curvePath, spanAt } from '@/features/Equalizer/utils/eqBands';
import { cn } from '@/lib/cn';

const VIEW = 1000;

type Props = {
  bands: readonly EqBand[];
  sampleRate: number;
  /** How far the plot's one scale goes each way. */
  rangeDb: number;
  /** Lines under the EQ's own curve and the nodes. */
  overlay: ReactNode;
  /** Who plays where, under the curve and the nodes too, and it can be pointed at where nothing's over it. */
  instruments: ReactNode;
  isOn: boolean;
  /** Said in the middle of the plot when there's nothing on it yet. */
  hint: string | null;
  selectedId: number | null;
  showWords: boolean;
  showEar: boolean;
  /** A range to light up, from the instruments. */
  highlight: HzRange | null;
  onSelect: (id: number) => void;
  onChange: (band: EqBand, group: string | null) => void;
  onDragEnd: () => void;
  onRemove: (id: number) => void;
  /** With where on the plot, each from 0 to 1. */
  onAdd: (x: number, y: number) => void;
  onWheelNode: (id: number, isUp: boolean) => void;
  className?: string;
};

export function ResponseCurve({
  bands,
  sampleRate,
  rangeDb,
  overlay,
  instruments,
  isOn,
  hint,
  selectedId,
  showWords,
  showEar,
  highlight,
  onSelect,
  onChange,
  onDragEnd,
  onRemove,
  onAdd,
  onWheelNode,
  className,
}: Props) {
  const plot = useRef<HTMLDivElement>(null);
  const line = useMemo(() => curvePath(bands, sampleRate, rangeDb), [bands, sampleRate, rangeDb]);
  const numbers = useMemo(() => bandNumbers(bands), [bands]);
  const fill = `${line}L${curveEndX(sampleRate)} ${VIEW / 2}L0 ${VIEW / 2}Z`;

  useNodeWheel(plot, onWheelNode);

  function onDoubleClick(event: MouseEvent<HTMLDivElement>): void {
    if (event.target instanceof Element && event.target.closest('[data-band-id]')) return;
    const box = event.currentTarget.getBoundingClientRect();
    onAdd((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height);
  }

  return (
    <div
      ref={plot}
      data-testid="eq-plot"
      className={cn('relative touch-none select-none', className)}
      onDoubleClick={onDoubleClick}
    >
      <PlotBackdrop rangeDb={rangeDb} />
      <Fade show={showWords} className="pointer-events-none absolute inset-0">
        <SoundWords />
      </Fade>
      <Fade show={showEar} className="pointer-events-none absolute inset-0">
        <EarContours />
      </Fade>
      {highlight === null ? null : (
        <div className="pointer-events-none absolute inset-y-0 bg-accent opacity-10" style={spanAt(...highlight)} />
      )}

      <Fade show={overlay !== null} className="pointer-events-none absolute inset-0">
        {overlay}
      </Fade>

      <Fade show={instruments !== null} className="absolute inset-0 flex">
        {instruments}
      </Fade>

      <svg
        aria-hidden
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        preserveAspectRatio="none"
        className={cn('pointer-events-none absolute inset-0 size-full overflow-visible', !isOn && 'opacity-40')}
      >
        <path d={fill} className="fill-accent opacity-15" />
        <path
          data-testid="eq-curve"
          d={line}
          vectorEffect="non-scaling-stroke"
          className={cn('fill-none stroke-accent [stroke-width:var(--focus-width)]', overlay !== null && 'opacity-60')}
        />
      </svg>

      <Fade
        show={hint !== null}
        className="pointer-events-none absolute inset-x-0 top-1/4 flex justify-center px-gutter text-center"
      >
        <Text as="p" variant="body" color="muted" className="max-w-160">
          {hint}
        </Text>
      </Fade>

      {bands.map((band) => (
        <BandNode
          key={band.id}
          bands={bands}
          band={band}
          sampleRate={sampleRate}
          rangeDb={rangeDb}
          number={numbers.get(band.id) ?? 0}
          isSelected={band.id === selectedId}
          plot={plot}
          onSelect={() => onSelect(band.id)}
          onChange={onChange}
          onDragEnd={onDragEnd}
          onRemove={() => onRemove(band.id)}
        />
      ))}
    </div>
  );
}
