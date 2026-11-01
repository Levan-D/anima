import { memo } from 'react';
import { EQ_MAX_GAIN_DB } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { Tooltip } from '@/components/ui/Tooltip';
import { HZ_LINES, MAJOR_HZ_LINES, ZONES } from '@/features/Equalizer/utils/chartData';
import { gainMarks, hzMarkWords, leftAt, spanAt, topAt, xOfHz, yOfGain } from '@/features/Equalizer/utils/eqBands';
import { cn } from '@/lib/cn';

const VIEW = 1000;
const GAIN_MARKS = gainMarks(EQ_MAX_GAIN_DB);

/** What never moves behind the curve, so nothing here renders again during a drag. */
export const PlotBackdrop = memo(function PlotBackdrop() {
  return (
    <>
      {ZONES.map(({ name, range: [low, high] }, index) => (
        <div
          key={name}
          className={cn('pointer-events-none absolute inset-y-0', index % 2 === 0 ? 'bg-eq-zone' : 'bg-eq-zone-alt')}
          style={spanAt(low, high)}
        />
      ))}

      <svg
        aria-hidden
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 size-full"
      >
        {HZ_LINES.map((hz) => (
          <line
            key={hz}
            x1={xOfHz(hz) * VIEW}
            x2={xOfHz(hz) * VIEW}
            y1={0}
            y2={VIEW}
            vectorEffect="non-scaling-stroke"
            className={MAJOR_HZ_LINES.includes(hz) ? 'stroke-eq-line-major' : 'stroke-eq-line'}
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
            className={gainDb === 0 ? 'stroke-text-faint' : 'stroke-eq-line'}
          />
        ))}
      </svg>

      {ZONES.map(({ name, note, range: [low, high] }) => (
        <div key={name} className="absolute bottom-full flex justify-center pb-0.5" style={spanAt(low, high)}>
          <Tooltip label={note} opensOnTap>
            <Button variant="mark" size="mark">
              {name}
            </Button>
          </Tooltip>
        </div>
      ))}

      {HZ_LINES.map((hz) => (
        <span key={hz} className="pointer-events-none absolute top-full -translate-x-1/2 pt-0.5" style={leftAt(hz)}>
          <Text variant="meta" color={MAJOR_HZ_LINES.includes(hz) ? 'muted' : 'faint'} tabular>
            {hzMarkWords(hz)}
          </Text>
        </span>
      ))}
      {GAIN_MARKS.map(({ gainDb, words }) => (
        <span
          key={gainDb}
          className="pointer-events-none absolute right-full -translate-y-1/2 pr-1.5"
          style={topAt(yOfGain(gainDb))}
        >
          <Text variant="meta" color={gainDb === 0 ? 'muted' : 'faint'} tabular>
            {words}
          </Text>
        </span>
      ))}
    </>
  );
});
