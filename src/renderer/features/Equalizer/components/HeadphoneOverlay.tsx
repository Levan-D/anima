import { useMemo } from 'react';
import type { EqBand } from '@shared/domain';
import { predictedLine } from '@shared/headphoneCurve';
import { Text } from '@/components/ui/Text';
import { spanAt, topAt, xOfHz, yOfGain } from '@/features/Equalizer/utils/eqBands';
import { linePath, rangePath, type FixedLines } from '@/features/Equalizer/utils/headphoneLines';
import { cn } from '@/lib/cn';

const VIEW = 1000;
const FADE_FROM_HZ = 6000;
const FADE_TO_HZ = 10_000;
const FADED_TO = 0.35;
const ABOVE_HZ = 20_000;

type Props = {
  lines: FixedLines;
  bands: readonly EqBand[];
  sampleRate: number;
  /** With the EQ off there's nothing to predict, and no point saying measured twice. */
  showPredicted: boolean;
  isTargetApproximate: boolean;
  isRangeShown: boolean;
  /** Said at the 0 line, when that's the target. */
  zeroWords: string | null;
};

// A mask rather than a gradient stroke: Chromium gets a gradient wrong on a non-scaling stroke in a stretched viewBox.
function fadeMask(): string {
  const from = xOfHz(FADE_FROM_HZ) * 100;
  const to = xOfHz(FADE_TO_HZ) * 100;
  return `linear-gradient(to right, black ${from}%, rgb(0 0 0 / ${FADED_TO}) ${to}%)`;
}

/** Measured, predicted and target on the plot's one scale, under the EQ's own curve and the nodes. */
export function HeadphoneOverlay({
  lines,
  bands,
  sampleRate,
  showPredicted,
  isTargetApproximate,
  isRangeShown,
  zeroWords,
}: Props) {
  const { measured, target, rangeDb } = lines;
  const preferencePath = useMemo(() => rangePath(rangeDb), [rangeDb]);
  const measuredPath = useMemo(() => (measured === null ? '' : linePath(measured, rangeDb)), [measured, rangeDb]);
  const targetPath = useMemo(() => (target === null ? '' : linePath(target, rangeDb)), [target, rangeDb]);
  const predictedPath =
    showPredicted && measured !== null ? linePath(predictedLine(measured, bands, sampleRate), rangeDb) : '';
  const mask = fadeMask();
  const zeroAt = topAt(yOfGain(0, rangeDb));

  return (
    <>
      <svg
        aria-hidden
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 size-full"
        style={{ maskImage: mask }}
      >
        <path
          data-testid="hp-range"
          d={preferencePath}
          vectorEffect="non-scaling-stroke"
          className={cn(
            'fill-text-muted/25 stroke-text-muted stroke-1 transition-opacity duration-(--dur-fast) ease-standard',
            !isRangeShown && 'opacity-0',
          )}
        />
      </svg>

      <svg
        aria-hidden
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 size-full"
      >
        {targetPath === '' ? null : (
          <path
            data-testid="hp-target"
            d={targetPath}
            vectorEffect="non-scaling-stroke"
            strokeDasharray={isTargetApproximate ? '6 4' : undefined}
            className="fill-none stroke-accent-complement [stroke-width:var(--focus-width)]"
          />
        )}
      </svg>

      <svg
        aria-hidden
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 size-full"
        style={{ maskImage: mask }}
      >
        <path
          data-testid="hp-measured"
          d={measuredPath}
          vectorEffect="non-scaling-stroke"
          className={cn('fill-none stroke-text-muted', predictedPath === '' && '[stroke-width:var(--focus-width)]')}
        />
        {predictedPath === '' ? null : (
          <path
            data-testid="hp-predicted"
            d={predictedPath}
            vectorEffect="non-scaling-stroke"
            className="fill-none stroke-text [stroke-width:var(--focus-width)]"
          />
        )}
      </svg>

      <div
        data-testid="hp-grey-above"
        className="pointer-events-none absolute inset-y-0 bg-scrim"
        style={spanAt(FADE_TO_HZ, ABOVE_HZ)}
      />

      {zeroWords === null ? null : (
        <span className="pointer-events-none absolute left-0 -translate-y-full pb-0.5 pl-1.5" style={zeroAt}>
          <Text variant="meta" color="muted">
            {zeroWords}
          </Text>
        </span>
      )}
    </>
  );
}
