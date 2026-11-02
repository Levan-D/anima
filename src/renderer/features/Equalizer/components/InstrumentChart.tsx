import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { INSTRUMENT_FAMILIES, instrumentSpan, type Instrument } from '@/features/Equalizer/utils/chartData';
import { spanAt, xOfHz } from '@/features/Equalizer/utils/eqBands';
import { cn } from '@/lib/cn';

const NO_NOTE = 'Hover or tap one for its note';
// Further along than this there's room for the name before the bar.
const NAME_BEFORE_FROM = 0.2;
// Past this there is no room for it after the bar.
const NAME_AFTER_UNTIL = 0.85;

const BAR = 'absolute top-1/2 h-1.5 -translate-y-1/2';

type RowProps = {
  instrument: Instrument;
  isHighlighted: boolean;
  isTabStop: boolean;
  onHighlight: (instrument: Instrument | null) => void;
  onFocusRow: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
};

function InstrumentRow({ instrument, isHighlighted, isTabStop, onHighlight, onFocusRow, onKeyDown }: RowProps) {
  const { name, fundamentals, harmonics, fringe } = instrument;
  const [low, high] = instrumentSpan(instrument);
  const isNameBefore = xOfHz(low) > NAME_BEFORE_FROM || xOfHz(high) > NAME_AFTER_UNTIL;
  const nameStyle: CSSProperties = isNameBefore
    ? { right: `${(1 - xOfHz(low)) * 100}%` }
    : { left: `${xOfHz(high) * 100}%` };

  return (
    <Button
      variant="row"
      size="chart-row"
      data-testid={`eq-instrument-${name}`}
      data-highlighted={isHighlighted}
      tabIndex={isTabStop ? 0 : -1}
      className="h-auto min-h-3 flex-1 data-[highlighted=true]:bg-surface-hover"
      onPointerEnter={() => onHighlight(instrument)}
      onPointerLeave={() => onHighlight(null)}
      onClick={() => onHighlight(instrument)}
      onFocus={() => {
        onFocusRow();
        onHighlight(instrument);
      }}
      onBlur={() => onHighlight(null)}
      onKeyDown={onKeyDown}
    >
      <span
        data-testid="eq-fundamentals-bar"
        className={cn(BAR, isHighlighted ? 'bg-accent' : 'bg-eq-fundamental')}
        style={spanAt(...fundamentals)}
      />
      {harmonics === null ? null : (
        <span
          className={cn(BAR, isHighlighted ? 'bg-accent opacity-50' : 'bg-eq-harmonic')}
          style={spanAt(...harmonics)}
        />
      )}
      {fringe.map((range) => (
        <span
          key={range[0]}
          className={cn(BAR, 'border', isHighlighted ? 'border-accent' : 'border-eq-fringe')}
          style={spanAt(...range)}
        />
      ))}
      <span className="absolute top-1/2 -translate-y-1/2 px-1.5" style={nameStyle}>
        <Text variant="meta" color={isHighlighted ? 'accent' : 'default'}>
          {name}
        </Text>
      </span>
    </Button>
  );
}

function LegendItem({ className, words }: { className: string; words: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn('h-1.5 w-4', className)} />
      <Text variant="meta" color="faint">
        {words}
      </Text>
    </span>
  );
}

type Props = {
  highlighted: Instrument | null;
  onHighlight: (instrument: Instrument | null) => void;
  className?: string;
};

/**
 * Who plays where, on the curve's own axis: it's as wide as the plot and places its bars with the same `xOfHz`. It fits the
 * plot's height, and scrolls only when a window is too short for that.
 */
export function InstrumentChart({ highlighted, onHighlight, className }: Props) {
  const [tabStop, setTabStop] = useState(INSTRUMENT_FAMILIES[0]?.instruments[0]?.name ?? '');

  function onRowKey(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const rows = [...(event.currentTarget.closest('[data-rows]')?.querySelectorAll('button') ?? [])];
    const next = rows[rows.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1)];
    next?.focus();
  }

  return (
    <div data-testid="eq-instruments" className={cn('flex min-h-0 flex-col gap-1', className)}>
      <div className="flex shrink-0 flex-wrap items-center gap-x-gap">
        <LegendItem className="bg-eq-fundamental" words="Fundamentals, the main tone" />
        <LegendItem className="bg-eq-harmonic" words="Harmonics, the overtones above it" />
        <LegendItem className="border border-eq-fringe" words="Breath, overblow, lowest notes" />
        <Text
          variant="meta"
          color={highlighted === null ? 'faint' : 'default'}
          className="min-w-0 flex-[1_0_100%] truncate"
        >
          {highlighted?.note ?? NO_NOTE}
        </Text>
      </div>
      <div data-rows className="flex min-h-0 flex-1 touch-pan-y flex-col overflow-x-hidden overflow-y-auto">
        {INSTRUMENT_FAMILIES.map(({ name, instruments }) => (
          <div key={name} role="group" aria-label={name} className="contents">
            <div className="flex min-h-3 flex-1 items-center">
              <Text variant="label" color="muted">
                {name}
              </Text>
            </div>
            {instruments.map((instrument) => (
              <InstrumentRow
                key={instrument.name}
                instrument={instrument}
                isHighlighted={highlighted?.name === instrument.name}
                isTabStop={tabStop === instrument.name}
                onHighlight={onHighlight}
                onFocusRow={() => setTabStop(instrument.name)}
                onKeyDown={onRowKey}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
