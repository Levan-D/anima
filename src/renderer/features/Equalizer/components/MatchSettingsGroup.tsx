import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  BASS_LIMIT_MAX_DB,
  BASS_LIMIT_MIN_DB,
  MATCH_DEFAULTS,
  type CorrectUpToHz,
  type HeadphoneMeasurement,
  type SealFit,
} from '@shared/headphone';
import type { CommandInput } from '@shared/ipc/contract';
import { Button } from '@/components/ui/Button';
import { Collapse } from '@/components/ui/Collapse';
import { Divider } from '@/components/ui/Divider';
import { Hint } from '@/components/ui/Hint';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Text } from '@/components/ui/Text';
import { ValueStepper } from '@/components/ui/ValueStepper';
import { gainWords, stepGain, typedGain } from '@/features/Equalizer/utils/eqBands';
import { cn } from '@/lib/cn';

const HANDLING = [
  { value: 'little', label: 'Little', db: 3 },
  { value: 'some', label: 'Some', db: 6 },
  { value: 'well', label: 'Well', db: 10 },
] as const;

const SEALS: readonly { value: SealFit; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'sealed', label: 'Seals well' },
  { value: 'varies', label: 'Varies' },
];

const TOPS = [
  { value: '2000', label: '2 kHz' },
  { value: '6000', label: '6 kHz' },
  { value: '10000', label: '10 kHz' },
] as const;

const LIMIT_STEP_DB = 0.5;

const clampLimit = (db: number) => Math.min(Math.max(db, BASS_LIMIT_MIN_DB), BASS_LIMIT_MAX_DB);

type SettingProps = {
  name: string;
  hint: string;
  says: string;
  children: ReactNode;
};

function Setting({ name, hint, says, children }: SettingProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-gap gap-y-2">
        <Hint label={hint} className="w-28 shrink-0">
          {name}
        </Hint>
        {children}
      </div>
      <Text as="p" variant="meta" color="faint">
        {says}
      </Text>
    </div>
  );
}

type Props = {
  /** Sits at the other end of the header's row. */
  aside?: ReactNode;
  measurement: HeadphoneMeasurement | null;
  onChange: (input: CommandInput<'headphones.setMatch'>) => void;
};

/** What a measurement can't say about a pair, per headphone. It changes nothing until Match to target is pressed again. */
export function MatchSettingsGroup({ measurement, onChange, aside }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const canUse = measurement !== null && measurement.hasCurve;
  const { bassLimitDb, seal, correctUpToHz } = measurement?.match ?? MATCH_DEFAULTS;
  const handling = HANDLING.find(({ db }) => db === bassLimitDb)?.value ?? 'exact';

  function set(setting: CommandInput<'headphones.setMatch'>['setting']): void {
    if (measurement !== null) onChange({ measurementId: measurement.id, setting });
  }

  function setLimit(db: number | null): void {
    if (db !== null) set({ bassLimitDb: clampLimit(db) });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-gap gap-y-2">
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={isOpen}
          data-testid="hp-match-settings"
          onClick={() => setIsOpen(!isOpen)}
        >
          Match settings
          <ChevronDown
            aria-hidden
            className={cn('transition-transform duration-(--dur-fast) ease-standard', isOpen && 'rotate-180')}
          />
        </Button>
        {aside}
      </div>
      <Collapse open={isOpen}>
        <div className="flex flex-col gap-3 pb-2">
          <Setting
            name="Bass handling"
            hint="A judgement call, not a published number"
            says="The most boost under 100 Hz, for how much this pair takes by your ears. Nothing published predicts it. Bass stops here too, so raise this if the Bass slider seems to do little"
          >
            <SegmentedControl
              label="How much bass boost this headphone handles"
              size="sm"
              items={HANDLING}
              value={handling}
              disabled={!canUse}
              onValueChange={(value) => setLimit(HANDLING.find((item) => item.value === value)?.db ?? null)}
            />
            <ValueStepper
              name="Most bass boost"
              hint="Most boost under 100 Hz"
              data-testid="hp-bass-limit"
              disabled={!canUse}
              value={gainWords(bassLimitDb)}
              onLower={() => setLimit(stepGain(bassLimitDb, -LIMIT_STEP_DB))}
              onRaise={() => setLimit(stepGain(bassLimitDb, LIMIT_STEP_DB))}
              onType={(text) => setLimit(typedGain(text))}
            />
          </Setting>
          <Setting
            name="Fit or seal"
            hint="A judgement call on how far to trust the bass level"
            says="Bass level on a rig only holds if the seal does. Under 100 Hz, Open corrects all of what's measured, Seals well 75%, and Varies 50%"
          >
            <SegmentedControl
              label="How this headphone fits"
              size="sm"
              items={SEALS}
              value={seal}
              disabled={!canUse}
              onValueChange={(value) => set({ seal: value })}
            />
          </Setting>
          <Setting
            name="Correct up to"
            hint="Where a measurement stops being trustworthy"
            says="Above this the correction fades out over half an octave, so it can't dig a notch where nothing was wrong. At 10 kHz only the average level is kept above that"
          >
            <SegmentedControl
              label="How high to correct"
              size="sm"
              items={TOPS}
              value={String(correctUpToHz) as `${CorrectUpToHz}`}
              disabled={!canUse}
              onValueChange={(value) => set({ correctUpToHz: Number(value) as CorrectUpToHz })}
            />
          </Setting>
          <Divider />
        </div>
      </Collapse>
    </div>
  );
}
