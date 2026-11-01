import { memo } from 'react';
import { Text } from '@/components/ui/Text';
import { equalLoudnessContour } from '@/features/Equalizer/utils/equalLoudness';
import { leftAt, topAt, xOfHz } from '@/features/Equalizer/utils/eqBands';

const VIEW = 1000;
const PHONS = [40, 80];
const TOP_SPL = 120;
const BOTTOM_SPL = 20;
const SCALE_MARKS = [120, 70, 20];

const yOfSpl = (spl: number) => (TOP_SPL - spl) / (TOP_SPL - BOTTOM_SPL);

const CONTOURS = PHONS.map((phon) => {
  const points = equalLoudnessContour(phon);
  const last = points.at(-1);
  return {
    phon,
    path: `M${points.map(({ hz, splDb }) => `${xOfHz(hz) * VIEW} ${yOfSpl(splDb) * VIEW}`).join('L')}`,
    labelHz: last?.hz ?? 1000,
    labelTop: yOfSpl(last?.splDb ?? BOTTOM_SPL),
  };
});

/** Equal loudness on the curve's own frequency axis. Its level scale, in dB SPL, is its own and sits at the far side. */
export const EarContours = memo(function EarContours() {
  return (
    <>
      <svg
        aria-hidden
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 size-full"
      >
        {CONTOURS.map(({ phon, path }) => (
          <path
            key={phon}
            d={path}
            data-testid="eq-ear-contour"
            vectorEffect="non-scaling-stroke"
            strokeDasharray="4 3"
            className="fill-none stroke-text-muted"
          />
        ))}
      </svg>
      {CONTOURS.map(({ phon, labelHz, labelTop }) => (
        <span
          key={phon}
          className="pointer-events-none absolute -translate-x-full -translate-y-full pr-1"
          style={{ ...leftAt(labelHz), ...topAt(labelTop) }}
        >
          <Text variant="meta" color="muted">
            {phon} phon
          </Text>
        </span>
      ))}
      {SCALE_MARKS.map((spl) => (
        <span
          key={spl}
          className="pointer-events-none absolute left-full -translate-y-1/2 pl-1.5"
          style={topAt(yOfSpl(spl))}
        >
          <Text variant="meta" color="faint" tabular>
            {spl}
          </Text>
        </span>
      ))}
    </>
  );
});
