import { Trash2 } from 'lucide-react';
import { EQ_BAND_KINDS, type EqBand, type EqBandKind } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Text } from '@/components/ui/Text';
import { ValueStepper } from '@/components/ui/ValueStepper';
import { wordAtHz } from '@/features/Equalizer/utils/chartData';
import {
  gainWords,
  hzWords,
  KIND_WORDS,
  qWords,
  stepGain,
  stepHz,
  stepQ,
  typedGain,
  typedHz,
  typedQ,
} from '@/features/Equalizer/utils/eqBands';

const KIND_ITEMS = EQ_BAND_KINDS.map((value) => ({ value, label: KIND_WORDS[value] }));

const HZ_OCTAVES = 1 / 6;
const GAIN_DB = 0.5;
const Q_OCTAVES = 1 / 4;

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

  function onTyped(text: string, read: (text: string) => number | null, field: 'frequencyHz' | 'gainDb' | 'q'): void {
    const typed = read(text);
    if (typed !== null) onChange({ ...band, [field]: typed });
  }

  const { frequencyHz, gainDb, q } = band;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-gap gap-y-2">
      <Text variant="label" color="muted" tabular>
        Band {number}
      </Text>
      <Text variant="meta" color="muted" tabular data-testid="eq-band-word">
        {hzWords(frequencyHz)} · {wordAtHz(frequencyHz)}
      </Text>
      <SegmentedControl size="sm" label="Kind of band" items={KIND_ITEMS} value={band.kind} onValueChange={setKind} />
      <ValueStepper
        name="Frequency"
        data-testid="eq-Frequency"
        isNameVisible={false}
        value={hzWords(frequencyHz)}
        onLower={() => onChange({ ...band, frequencyHz: stepHz(frequencyHz, -HZ_OCTAVES) })}
        onRaise={() => onChange({ ...band, frequencyHz: stepHz(frequencyHz, HZ_OCTAVES) })}
        onType={(text) => onTyped(text, typedHz, 'frequencyHz')}
      />
      <ValueStepper
        name="Gain"
        data-testid="eq-Gain"
        value={gainWords(gainDb)}
        onLower={() => onChange({ ...band, gainDb: stepGain(gainDb, -GAIN_DB) })}
        onRaise={() => onChange({ ...band, gainDb: stepGain(gainDb, GAIN_DB) })}
        onType={(text) => onTyped(text, typedGain, 'gainDb')}
      />
      <ValueStepper
        name="Q"
        data-testid="eq-Q"
        value={qWords(q)}
        onLower={() => onChange({ ...band, q: stepQ(q, -Q_OCTAVES) })}
        onRaise={() => onChange({ ...band, q: stepQ(q, Q_OCTAVES) })}
        onType={(text) => onTyped(text, typedQ, 'q')}
      />
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Remove band"
        className="ml-auto"
        disabled={!canRemove}
        onClick={onRemove}
      >
        <Trash2 aria-hidden />
      </Button>
    </div>
  );
}
