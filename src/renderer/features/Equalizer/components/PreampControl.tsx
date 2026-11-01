import { EQ_MAX_PREAMP_DB, EQ_MIN_PREAMP_DB, type EqSettings } from '@shared/domain';
import { clipDb, effectivePreampDb } from '@shared/eqCurve';
import { Checkbox } from '@/components/ui/Checkbox';
import { Text } from '@/components/ui/Text';
import { ValueStepper } from '@/components/ui/ValueStepper';
import { gainWords, typedPreamp } from '@/features/Equalizer/utils/eqBands';

const STEP_DB = 0.5;
// Only measured on music, and no preamp is a limiter.
const AUTO_NOTE = 'Room for most music, not a guarantee';

function stepped(db: number, by: number): number {
  const next = Math.round((db + by) * 10) / 10;
  return Math.min(Math.max(next, EQ_MIN_PREAMP_DB), EQ_MAX_PREAMP_DB);
}

type Props = {
  eq: EqSettings;
  onChange: (preamp: EqSettings['preamp']) => void;
};

/** The EQ's own volume, automatic like foobar2000's by default. Unticking Auto starts from what it was, so nothing jumps. */
export function PreampControl({ eq, onChange }: Props) {
  const { preamp } = eq;
  const effective = effectivePreampDb(eq);
  const clip = clipDb(eq);

  function setAuto(auto: boolean): void {
    onChange({ auto, db: auto ? preamp.db : stepped(effective, 0) });
  }

  function onType(text: string): void {
    const typed = typedPreamp(text);
    if (typed !== null) onChange({ auto: false, db: typed });
  }

  return (
    <div className="-my-2 flex min-w-0 items-center gap-2">
      {clip > 0 ? (
        <Text variant="meta" color="muted" data-testid="eq-clip-note" className="shrink-0">
          may clip by about +{clip.toFixed(1)} dB
        </Text>
      ) : null}
      {preamp.auto && effective < 0 ? (
        <Text variant="meta" color="faint" truncate data-testid="eq-headroom-note" className="min-w-0">
          {AUTO_NOTE}
        </Text>
      ) : null}
      <Text variant="meta" color="muted">
        Preamp
      </Text>
      <Checkbox checked={preamp.auto} onCheckedChange={setAuto}>
        <Text variant="meta" color="muted">
          Auto
        </Text>
      </Checkbox>
      <ValueStepper
        name="Preamp"
        isNameVisible={false}
        data-testid="eq-Preamp"
        value={gainWords(effective)}
        disabled={preamp.auto}
        onLower={() => onChange({ auto: false, db: stepped(preamp.db, -STEP_DB) })}
        onRaise={() => onChange({ auto: false, db: stepped(preamp.db, STEP_DB) })}
        onType={onType}
      />
    </div>
  );
}
