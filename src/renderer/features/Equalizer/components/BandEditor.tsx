import { Trash2 } from 'lucide-react';
import { EQ_BAND_KINDS, type EqBand, type EqBandKind } from '@shared/domain';
import { isBandActive } from '@shared/eqCurve';
import { Button } from '@/components/ui/Button';
import { Hint } from '@/components/ui/Hint';
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

const SHAPE_NOTE =
  'Peak lifts or cuts around its frequency. Low shelf moves everything below it, high shelf everything above';
const Q_NOTE = 'How wide the band is: low is broad, high is narrow. On a shelf, how steep its step is';

type Props = {
  band: EqBand;
  sampleRate: number;
  number: number;
  canRemove: boolean;
  onChange: (band: EqBand) => void;
  onRemove: () => void;
};

export function BandEditor({ band, sampleRate, number, canRemove, onChange, onRemove }: Props) {
  function setKind(kind: EqBandKind): void {
    onChange({ ...band, kind });
  }

  function onTyped(text: string, read: (text: string) => number | null, field: 'frequencyHz' | 'gainDb' | 'q'): void {
    const typed = read(text);
    if (typed !== null) onChange({ ...band, [field]: typed });
  }

  const { frequencyHz, gainDb, q } = band;
  const isActive = isBandActive(band, sampleRate);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-gap gap-y-2">
      <Text variant="label" color="muted" tabular>
        Band {number}
      </Text>
      <Text
        variant="meta"
        color="muted"
        tabular
        data-testid="eq-band-word"
        title={isActive ? undefined : `This file stops at ${hzWords(sampleRate / 2)}, so this band does nothing to it`}
      >
        {hzWords(frequencyHz)} · {isActive ? wordAtHz(frequencyHz) : 'inactive'}
      </Text>
      <div className="flex items-center gap-1.5">
        <Hint label={SHAPE_NOTE}>Shape</Hint>
        <SegmentedControl size="sm" label="Kind of band" items={KIND_ITEMS} value={band.kind} onValueChange={setKind} />
      </div>
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
        hint={Q_NOTE}
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
