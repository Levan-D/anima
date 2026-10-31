import { Minus, Plus, Trash2 } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { EQ_BAND_KINDS, type EqBand, type EqBandKind } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Text } from '@/components/ui/Text';
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

type StepperProps = {
  name: string;
  /** The value in words, also what can be typed over. */
  value: string;
  onLower: () => void;
  onRaise: () => void;
  /** With what was typed. What doesn't read as a number is dropped, and the value goes back. */
  onType: (text: string) => void;
};

function Stepper({ name, value, onLower, onRaise, onType }: StepperProps) {
  const [typing, setTyping] = useState<string | null>(null);

  function commit(): void {
    if (typing !== null && typing !== value) onType(typing);
    setTyping(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') commit();
  }

  return (
    <div className="flex items-center gap-1.5">
      <Text variant="meta" color="muted">
        {name}
      </Text>
      <div className="flex h-8 items-center rounded-md border border-outline">
        <Button variant="ghost" size="icon-sm" aria-label={`Lower ${name}`} className="h-full" onClick={onLower}>
          <Minus aria-hidden />
        </Button>
        <Input
          aria-label={name}
          data-testid={`eq-${name}`}
          spellCheck={false}
          value={typing ?? value}
          onFocus={(event) => {
            setTyping(value);
            event.currentTarget.select();
          }}
          onChange={(event) => setTyping(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          className="w-19 bg-transparent px-0 text-center tabular-nums"
        />
        <Button variant="ghost" size="icon-sm" aria-label={`Raise ${name}`} className="h-full" onClick={onRaise}>
          <Plus aria-hidden />
        </Button>
      </div>
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
      <SegmentedControl size="sm" label="Kind of band" items={KIND_ITEMS} value={band.kind} onValueChange={setKind} />
      <Stepper
        name="Frequency"
        value={hzWords(frequencyHz)}
        onLower={() => onChange({ ...band, frequencyHz: stepHz(frequencyHz, -HZ_OCTAVES) })}
        onRaise={() => onChange({ ...band, frequencyHz: stepHz(frequencyHz, HZ_OCTAVES) })}
        onType={(text) => onTyped(text, typedHz, 'frequencyHz')}
      />
      <Stepper
        name="Gain"
        value={gainWords(gainDb)}
        onLower={() => onChange({ ...band, gainDb: stepGain(gainDb, -GAIN_DB) })}
        onRaise={() => onChange({ ...band, gainDb: stepGain(gainDb, GAIN_DB) })}
        onType={(text) => onTyped(text, typedGain, 'gainDb')}
      />
      <Stepper
        name="Q"
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
