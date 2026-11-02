import { ChevronDown, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { EqSettings } from '@shared/domain';
import { canCompare, matchedOff, type RigMatch } from '@shared/headphoneCurve';
import { TARGET_BASS_MAX_DB, TARGET_BASS_MIN_DB, type HeadphoneKind, type HeadphoneTarget } from '@shared/headphone';
import { Button } from '@/components/ui/Button';
import { Collapse } from '@/components/ui/Collapse';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import { Hint } from '@/components/ui/Hint';
import type { MenuEntry } from '@/components/ui/menuEntries';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Slider } from '@/components/ui/Slider';
import { Text } from '@/components/ui/Text';
import { cn } from '@/lib/cn';
import { Tooltip } from '@/components/ui/Tooltip';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AutoEqDialog } from '@/features/Equalizer/components/AutoEqDialog';
import { HeadphoneImportDialog } from '@/features/Equalizer/components/HeadphoneImportDialog';
import { HoldToCompare } from '@/features/Equalizer/components/HoldToCompare';
import { MatchSettingsGroup } from '@/features/Equalizer/components/MatchSettingsGroup';
import type { EqCompare } from '@/features/Equalizer/hooks/useEqCompare';
import type { Headphones } from '@/features/Equalizer/hooks/useHeadphones';
import {
  ALIGNED,
  BASS_NOTE,
  CAVEAT,
  COMPARE_NOTE,
  compareShortWords,
  differenceWords,
  matchOf,
  measuredWords,
  whatsOffWords,
  originWords,
  predictedWords,
  RANGE_SOURCE,
  RANGE_WORDS,
  targetWords,
} from '@/features/Equalizer/utils/headphoneLines';

// What's said on a target's row, and the order: what fits this headphone comes first.
const RIG_WORDS: Partial<Record<RigMatch, string>> = { defined: 'Same rig', approximate: 'Close rig' };
const RIG_ORDER: Record<RigMatch, number> = { defined: 0, approximate: 1, different: 2, unknown: 2 };

const VIEWS = [
  { value: 'smoothed', label: 'Smoothed' },
  { value: 'raw', label: 'Raw' },
] as const;

const BASS_STEP_DB = 0.5;

const DELETE_WORDS: Record<HeadphoneKind, string> = {
  measurement: 'This measurement comes off this computer. Any EQ preset you made from it stays',
  target: 'This target comes off this computer',
};

type Asking = { kind: 'import'; what: HeadphoneKind } | { kind: 'autoeq' } | null;

function item(label: string, onSelect: () => void, destructive = false): MenuEntry {
  return { kind: 'item', label, onSelect, destructive };
}

type LegendProps = {
  words: string;
  swatch: string;
};

/** One line's name with a stroke of its look, since the plot has no room for labels on the lines themselves. */
function Legend({ words, swatch }: LegendProps) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span aria-hidden className={`w-5 shrink-0 border-t-2 ${swatch}`} />
      <Text variant="meta" color="muted">
        {words}
      </Text>
    </span>
  );
}

type Props = {
  headphones: Headphones;
  eq: EqSettings;
  sampleRate: number;
  compare: EqCompare;
  className?: string;
};

/** What's behind the one small control: choosing what to draw, and what the screen owes the reader about it. */
export function HeadphoneTools({ headphones, eq, sampleRate, compare, className }: Props) {
  const { state, measurement, target, match, lines, hasTargetCurve, adopt, setOption, select, remove } = headphones;
  const [asking, setAsking] = useState<Asking>(null);
  const [bass, setBass] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<{ kind: HeadphoneKind; id: number; name: string } | null>(null);
  if (state === null) return null;

  const { showRaw, showDifference, bassDb, showRange } = state.options;
  const isTargetShown = lines?.isTargetShown ?? false;
  const isRangeOn = showRange && headphones.canShowRange;
  const isDifferenceOn = lines?.isDifference ?? false;
  const canCompareNow = canCompare(eq);
  const short = canCompareNow ? compareShortWords(matchedOff(eq, sampleRate).shortByDb) : null;

  const measurementEntries: MenuEntry[] = [
    item('None', () => select({ measurementId: null })),
    ...state.measurements.map(({ id, headphone, source }) => ({
      ...item(`${headphone}, ${source}`, () => select({ measurementId: id })),
      actions: [
        {
          label: `Delete ${headphone}`,
          icon: Trash2,
          isDanger: true,
          onSelect: () => setDeleting({ kind: 'measurement', id, name: headphone }),
        },
      ],
    })),
  ];
  const measurementFooter: MenuEntry[] = [
    item('Find on AutoEq', () => setAsking({ kind: 'autoeq' })),
    item('Import a file', () => setAsking({ kind: 'import', what: 'measurement' })),
  ];

  const rigOrder = (candidate: HeadphoneTarget) => RIG_ORDER[matchOf(measurement, candidate)];
  const targetEntries: MenuEntry[] = [
    item('None', () => select({ targetId: null })),
    ...state.targets
      .toSorted((one, other) => rigOrder(one) - rigOrder(other))
      .map((candidate): MenuEntry => {
        const { id, name, origin } = candidate;
        const rigWord = RIG_WORDS[matchOf(measurement, candidate)];
        return {
          kind: 'item',
          label: name,
          onSelect: () => select({ targetId: id }),
          ...(rigWord === undefined ? {} : { shortcut: rigWord }),
          isCurrent: id === target?.id,
          // AutoEq's are fetched and kept. What someone imported is theirs to remove.
          ...(origin.kind === 'file'
            ? {
                actions: [
                  {
                    label: `Delete ${name}`,
                    icon: Trash2,
                    isDanger: true,
                    onSelect: () => setDeleting({ kind: 'target', id, name }),
                  },
                ],
              }
            : {}),
        };
      }),
  ];
  const targetFooter: MenuEntry[] = [
    {
      kind: 'item',
      label: headphones.isFetchingCurves ? 'Fetching curves' : 'Refetch curves',
      disabled: headphones.isFetchingCurves,
      onSelect: headphones.refetchCurves,
    },
    item('Import a file', () => setAsking({ kind: 'import', what: 'target' })),
  ];

  const targetSays = targetWords(target, match, hasTargetCurve);
  const whatsOff = whatsOffWords(measurement, target, match, hasTargetCurve);
  const canMatch = isTargetShown && measurement?.hasCurve === true && target !== null && hasTargetCurve;
  const matchSays = isTargetShown ? 'Fit an EQ to this target and Bass' : 'Pick a target this rig can show';

  return (
    <div data-testid="hp-tools" className={className}>
      <div className="flex flex-wrap items-center gap-x-gap gap-y-2">
        <DropdownMenu entries={measurementEntries} footer={measurementFooter} align="start">
          <Button variant="outline" size="sm" data-testid="hp-measurement" className="max-w-80 [&>span]:min-w-0">
            <span className="min-w-0 truncate">{measurement?.headphone ?? 'Choose a measurement'}</span>
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenu>
        <DropdownMenu entries={targetEntries} footer={targetFooter} align="start">
          <Button variant="outline" size="sm" data-testid="hp-target-menu" className="max-w-80 [&>span]:min-w-0">
            <span className="min-w-0 truncate">{target?.name ?? 'No target'}</span>
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenu>
        <div className="ml-auto flex flex-wrap items-center gap-x-gap gap-y-2">
          <Tooltip label={matchSays}>
            {/* A disabled button takes no pointer, and the tooltip is what says why. */}
            <span className="inline-flex">
              <Button
                variant="outline"
                size="sm"
                data-testid="hp-match"
                disabled={!canMatch}
                loading={headphones.isMatching}
                onClick={() => {
                  if (measurement !== null && target !== null) {
                    headphones.fitToTarget({ measurementId: measurement.id, targetId: target.id });
                  }
                }}
              >
                Match to target
              </Button>
            </span>
          </Tooltip>
          {measurement?.hasPreset === true ? (
            <Tooltip label="AutoEq's own EQ for this headphone. The target here doesn't change it">
              <Button variant="outline" size="sm" onClick={() => headphones.usePreset(measurement.id)}>
                Use AutoEq's correction
              </Button>
            </Tooltip>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-gap gap-y-2">
        <SegmentedControl
          label="How the measurement is drawn"
          size="sm"
          items={VIEWS}
          value={showRaw ? 'raw' : 'smoothed'}
          disabled={lines === null}
          onValueChange={(view) => setOption({ showRaw: view === 'raw' })}
        />
        <Tooltip label={target === null ? 'Show the headphone against the target' : differenceWords(target)}>
          <Button
            variant={showDifference && isTargetShown ? 'outline' : 'ghost'}
            size="sm"
            aria-pressed={showDifference && isTargetShown}
            disabled={!isTargetShown}
            className={cn(!(showDifference && isTargetShown) && 'border border-transparent')}
            onClick={() => setOption({ showDifference: !showDifference })}
          >
            Difference
          </Button>
        </Tooltip>
        <Tooltip label={isDifferenceOn ? 'Off in Difference' : 'Shade on the plot'}>
          {/* A disabled button takes no pointer, and the tooltip is what says why. */}
          <span className="inline-flex">
            <Button
              variant={isRangeOn && !isDifferenceOn ? 'outline' : 'ghost'}
              size="sm"
              data-testid="hp-range-toggle"
              aria-pressed={isRangeOn && !isDifferenceOn}
              disabled={!headphones.canShowRange || isDifferenceOn}
              className={cn(!(isRangeOn && !isDifferenceOn) && 'border border-transparent')}
              onClick={() => setOption({ showRange: !showRange })}
            >
              Preference range
            </Button>
          </span>
        </Tooltip>
        <div className="flex w-72 max-w-full items-center gap-2">
          <Hint label={BASS_NOTE} className="shrink-0">
            Bass
          </Hint>
          <Slider
            label="Bass on the target"
            min={TARGET_BASS_MIN_DB}
            max={TARGET_BASS_MAX_DB}
            step={BASS_STEP_DB}
            disabled={!isTargetShown}
            value={bass ?? bassDb}
            onValueChange={setBass}
            onValueCommit={(value) => {
              setBass(null);
              setOption({ bassDb: value });
            }}
          />
          <Text variant="meta" color="muted" tabular className="w-14 shrink-0">
            {`${(bass ?? bassDb) > 0 ? '+' : ''}${bass ?? bassDb} dB`}
          </Text>
        </div>
        <div className="ml-auto">
          <HoldToCompare compare={compare} disabled={!canCompareNow} />
        </div>
      </div>

      <MatchSettingsGroup measurement={measurement} onChange={headphones.setMatch} />

      <div className="mt-1 flex flex-col gap-0.5">
        <Text as="p" variant="meta" color="faint">
          {short === null ? COMPARE_NOTE : `${COMPARE_NOTE}. ${short}`}
        </Text>
        {headphones.isFetchingCurves ? (
          <Text as="p" variant="meta" data-testid="hp-curves-fetching">
            Fetching AutoEq's curves. Once they're here they stay
          </Text>
        ) : null}
        {headphones.curvesProblem === null ? null : (
          <div className="flex flex-wrap items-center gap-x-gap" data-testid="hp-curves-problem">
            <Text as="p" variant="meta">
              {headphones.curvesProblem}
            </Text>
            <Button variant="outline" size="sm" onClick={headphones.refetchCurves}>
              Try again
            </Button>
          </div>
        )}
        {whatsOff === null ? null : (
          <Text as="p" variant="meta" data-testid="hp-whats-off">
            {whatsOff}
          </Text>
        )}
        {lines !== null && measurement !== null ? (
          <>
            <div className="flex flex-wrap gap-x-gap">
              {eq.enabled ? <Legend swatch="border-text" words={predictedWords(measurement)} /> : null}
              <Legend swatch="border-text-muted" words={measuredWords(measurement, showRaw)} />
            </div>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <Text variant="meta" color="muted">
                {`${CAVEAT}. ${ALIGNED}`}
              </Text>
              <Hint label={originWords(measurement)}>Where this is from</Hint>
            </div>
          </>
        ) : null}
        {targetSays !== null && isTargetShown ? (
          <Legend
            swatch={match === 'approximate' ? 'border-dashed border-accent-complement' : 'border-accent-complement'}
            words={targetSays}
          />
        ) : null}
        <Collapse open={headphones.isRangeShown}>
          <div className="flex flex-wrap items-baseline gap-x-2" data-testid="hp-range-words">
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden className="h-2 w-5 shrink-0 bg-text-muted/25" />
              <Text variant="meta" color="muted">
                {RANGE_WORDS}
              </Text>
            </span>
            <Hint label={RANGE_SOURCE}>Where this is from</Hint>
          </div>
        </Collapse>
      </div>

      {asking?.kind === 'import' ? (
        <HeadphoneImportDialog kind={asking.what} onDone={adopt} onClose={() => setAsking(null)} />
      ) : null}
      {asking?.kind === 'autoeq' ? <AutoEqDialog onDone={adopt} onClose={() => setAsking(null)} /> : null}
      {deleting === null ? null : (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          description={DELETE_WORDS[deleting.kind]}
          confirmLabel="Delete"
          onConfirm={() => remove(deleting.kind, deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
