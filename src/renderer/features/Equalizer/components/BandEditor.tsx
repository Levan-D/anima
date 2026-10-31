import { Minus, Plus, Trash2 } from 'lucide-react';
import { EQ_BAND_KINDS, type EqBand, type EqBandKind } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Text } from '@/components/ui/Text';
import { gainWords, hzWords, KIND_WORDS, qWords, stepGain, stepHz, stepQ } from '@/features/Equalizer/utils/eqBands';

const KIND_ITEMS = EQ_BAND_KINDS.map((value) => ({ value, label: KIND_WORDS[value] }));

const HZ_OCTAVES = 1 / 6;
const GAIN_DB = 0.5;
const Q_OCTAVES = 1 / 4;

type StepperProps = {
  name: string;
  value: string;
  onLower: () => void;
  onRaise: () => void;
};

function Stepper({ name, value, onLower, onRaise }: StepperProps) {
  return (
    <div className="flex flex-1 basis-40 items-center justify-between">
      <Button variant="ghost" size="icon" aria-label={`Lower ${name}`} onClick={onLower}>
        <Minus aria-hidden />
      </Button>
      <div className="flex min-w-0 flex-col items-center">
        <Text variant="meta" color="muted">
          {name}
        </Text>
        <Text variant="body" tabular data-testid={`eq-${name}`}>
          {value}
        </Text>
      </div>
      <Button variant="ghost" size="icon" aria-label={`Raise ${name}`} onClick={onRaise}>
        <Plus aria-hidden />
      </Button>
    </div>
  );
}

type Props = {
  band: EqBand;
  number: number;
  canRemove: boolean;
  onChange: (band: EqBand) => void;
  onRemove: () => void;
};

export function BandEditor({ band, number, canRemove, onChange, onRemove }: Props) {
  function setKind(kind: EqBandKind): void {
    onChange({ ...band, kind });
  }

  const { frequencyHz, gainDb, q } = band;

  return (
    <div className="flex flex-col gap-1 px-gutter">
      <div className="flex flex-wrap items-center justify-between gap-x-gap gap-y-1">
        <Text variant="label" color="muted">
          Band {number}
        </Text>
        <SegmentedControl label="Kind of band" items={KIND_ITEMS} value={band.kind} onValueChange={setKind} />
        <Button variant="ghost" size="icon" aria-label="Remove band" disabled={!canRemove} onClick={onRemove}>
          <Trash2 aria-hidden />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-gap">
        <Stepper
          name="Frequency"
          value={hzWords(frequencyHz)}
          onLower={() => onChange({ ...band, frequencyHz: stepHz(frequencyHz, -HZ_OCTAVES) })}
          onRaise={() => onChange({ ...band, frequencyHz: stepHz(frequencyHz, HZ_OCTAVES) })}
        />
        <Stepper
          name="Gain"
          value={gainWords(gainDb)}
          onLower={() => onChange({ ...band, gainDb: stepGain(gainDb, -GAIN_DB) })}
          onRaise={() => onChange({ ...band, gainDb: stepGain(gainDb, GAIN_DB) })}
        />
        <Stepper
          name="Q"
          value={qWords(q)}
          onLower={() => onChange({ ...band, q: stepQ(q, -Q_OCTAVES) })}
          onRaise={() => onChange({ ...band, q: stepQ(q, Q_OCTAVES) })}
        />
      </div>
    </div>
  );
}
