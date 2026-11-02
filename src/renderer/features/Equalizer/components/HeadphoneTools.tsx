import { ChevronDown, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { EqSettings } from '@shared/domain';
import { canCompare, matchedOff } from '@shared/headphoneCurve';
import {
  AUTOEQ_TARGETS,
  rigWords,
  TARGET_BASS_MAX_DB,
  TARGET_BASS_MIN_DB,
  type HeadphoneKind,
} from '@shared/headphone';
import { Button } from '@/components/ui/Button';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import { Hint } from '@/components/ui/Hint';
import type { MenuEntry } from '@/components/ui/menuEntries';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Slider } from '@/components/ui/Slider';
import { Switch } from '@/components/ui/Switch';
import { Text } from '@/components/ui/Text';
import { Tooltip } from '@/components/ui/Tooltip';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AutoEqDialog } from '@/features/Equalizer/components/AutoEqDialog';
import { HeadphoneImportDialog } from '@/features/Equalizer/components/HeadphoneImportDialog';
import { HoldToCompare } from '@/features/Equalizer/components/HoldToCompare';
import type { EqCompare } from '@/features/Equalizer/hooks/useEqCompare';
import type { Headphones } from '@/features/Equalizer/hooks/useHeadphones';
import {
  ALIGNED,
  BASS_NOTE,
  CAVEAT,
  COMPARE_NOTE,
  compareShortWords,
  differenceWords,
  measuredWords,
  originWords,
  predictedWords,
  targetWords,
} from '@/features/Equalizer/utils/headphoneLines';

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

  const { showRaw, showDifference, bassDb } = state.options;
  const isTargetShown = lines?.isTargetShown ?? false;
  const canCompareNow = canCompare(eq);
  const short = canCompareNow ? compareShortWords(matchedOff(eq, sampleRate).shortByDb) : null;
  const isPresetOnly = measurement !== null && !measurement.hasCurve;

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
    { kind: 'separator' },
    item('Find on AutoEq', () => setAsking({ kind: 'autoeq' })),
    item('Import a file', () => setAsking({ kind: 'import', what: 'measurement' })),
  ];

  const targetEntries: MenuEntry[] = [
    item('None', () => select({ targetId: null })),
    ...state.targets.map(({ id, name }) => ({
      ...item(name, () => select({ targetId: id })),
      actions: [
        {
          label: `Delete ${name}`,
          icon: Trash2,
          isDanger: true,
          onSelect: () => setDeleting({ kind: 'target', id, name }),
        },
      ],
    })),
    { kind: 'separator' },
    {
      kind: 'submenu',
      label: 'Fetch from AutoEq',
      entries: AUTOEQ_TARGETS.map(({ file, rig }) =>
        item(`${file} (${rigWords(rig)})`, () => headphones.fetchTarget(file)),
      ),
    },
    item('Import a file', () => setAsking({ kind: 'import', what: 'target' })),
  ];

  const targetSays = targetWords(target, match, hasTargetCurve);

  return (
    <div data-testid="hp-tools" className={className}>
      <div className="flex flex-wrap items-center gap-x-gap gap-y-2">
        <DropdownMenu entries={measurementEntries} align="start">
          <Button variant="outline" size="sm" data-testid="hp-measurement" className="max-w-80 [&>span]:min-w-0">
            <span className="min-w-0 truncate">{measurement?.headphone ?? 'Choose a measurement'}</span>
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenu>
        {measurement?.hasPreset === true ? (
          <Tooltip label="AutoEq's own EQ for this headphone. The target here doesn't change it">
            <Button variant="outline" size="sm" onClick={() => headphones.usePreset(measurement.id)}>
              Use AutoEq's correction
            </Button>
          </Tooltip>
        ) : null}
        <DropdownMenu entries={targetEntries} align="start">
          <Button variant="outline" size="sm" data-testid="hp-target-menu" className="max-w-80 [&>span]:min-w-0">
            <span className="min-w-0 truncate">{target?.name ?? 'No target'}</span>
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenu>
        {lines === null ? null : (
          <SegmentedControl
            label="How the measurement is drawn"
            size="sm"
            items={VIEWS}
            value={showRaw ? 'raw' : 'smoothed'}
            onValueChange={(view) => setOption({ showRaw: view === 'raw' })}
          />
        )}
        {isTargetShown && target !== null ? (
          <Switch checked={showDifference} onCheckedChange={(isOn) => setOption({ showDifference: isOn })}>
            <Text variant="meta" color="muted">
              {differenceWords(target)}
            </Text>
          </Switch>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-gap gap-y-1">
        {isTargetShown ? (
          <div className="flex min-w-60 flex-1 items-center gap-2">
            <Hint label={BASS_NOTE} className="shrink-0">
              Bass on the target
            </Hint>
            <Slider
              label="Bass on the target"
              min={TARGET_BASS_MIN_DB}
              max={TARGET_BASS_MAX_DB}
              step={BASS_STEP_DB}
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
        ) : null}
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <Text variant="meta" color="faint">
            {short === null ? COMPARE_NOTE : `${COMPARE_NOTE}. ${short}`}
          </Text>
          <HoldToCompare compare={compare} disabled={!canCompareNow} />
        </div>
      </div>

      <div className="mt-1 flex flex-col gap-0.5">
        {measurement === null ? (
          <Text as="p" variant="meta" color="muted">
            Pick a headphone to see its measured response and how your EQ moves it
          </Text>
        ) : null}
        {measurement !== null && target === null ? (
          <Text as="p" variant="meta" color="muted">
            A target is a curve to compare against, usually what most listeners preferred. It's a reference, not the
            right sound
          </Text>
        ) : null}
        {isPresetOnly ? (
          <Text as="p" variant="meta" color="muted">
            {`${measurement.source}'s measurements aren't public, so there's a preset here and no line to draw`}
          </Text>
        ) : null}
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
            swatch={match === 'approximate' ? 'border-dashed border-signal-adjusted' : 'border-signal-adjusted'}
            words={targetSays}
          />
        ) : null}
        {targetSays !== null && !isTargetShown ? (
          <Text as="p" variant="meta" color="muted">
            {targetSays}
          </Text>
        ) : null}
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
