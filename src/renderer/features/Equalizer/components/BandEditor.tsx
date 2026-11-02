import { Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { EQ_BAND_KINDS, type EqBand, type EqBandKind } from '@shared/domain';
import { isBandActive } from '@shared/eqCurve';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Text } from '@/components/ui/Text';
import { Tooltip } from '@/components/ui/Tooltip';
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

const Q_NOTE = 'Q: how wide the band is';

type Props = {
  band: EqBand;
  sampleRate: number;
  number: number;
  canRemove: boolean;
  onChange: (band: EqBand) => void;
  onRemove: () => void;
  /** Before the band's name on the lower row. */
  preamp: ReactNode;
  /** At the far end of it. */
  end: ReactNode;
};

export function BandEditor({ band, sampleRate, number, canRemove, onChange, onRemove, preamp, end }: Props) {
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
    <div className="flex shrink-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-gap gap-y-2">
        <ValueStepper
          name="Frequency"
          data-testid="eq-Frequency"
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
        <SegmentedControl
          size="sm"
          label="Kind of band"
          className="rounded-md border-outline"
          items={KIND_ITEMS}
          value={band.kind}
          onValueChange={setKind}
        />
        <Tooltip label="Remove band">
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
        </Tooltip>
      </div>
      <Divider />
      <div className="flex flex-wrap items-center gap-x-gap gap-y-2">
        {preamp}
        <Text variant="label" color="muted" tabular>
          Band {number}
        </Text>
        <Text
          variant="meta"
          color="muted"
          tabular
          data-testid="eq-band-word"
          title={
            isActive ? undefined : `This file stops at ${hzWords(sampleRate / 2)}, so this band does nothing to it`
          }
        >
          {hzWords(frequencyHz)} · {isActive ? wordAtHz(frequencyHz) : 'inactive'}
        </Text>
        <div className="ml-auto flex shrink-0 items-center">{end}</div>
      </div>
    </div>
  );
}
