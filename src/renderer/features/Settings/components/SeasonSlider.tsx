import { useState } from 'react';
import { Slider } from '@/components/ui/Slider';
import { Text } from '@/components/ui/Text';

const STEPS = 20;

type Props = {
  title: string;
  description: string;
  label: string;
  low: string;
  high: string;
  max: number;
  value: number;
  onCommit: (value: number) => Promise<void>;
};

/** Follows the thumb while it's held, and only tells main when it's let go, since that re-picks what's ahead. */
export function SeasonSlider({ title, description, label, low, high, max, value, onCommit }: Props) {
  const [held, setHeld] = useState<number | null>(null);

  return (
    <div className="flex flex-col gap-1 pt-3">
      <Text as="p">{title}</Text>
      <Text as="p" variant="meta" color="muted">
        {description}
      </Text>
      <Slider
        label={label}
        min={0}
        max={max}
        step={max / STEPS}
        value={held ?? value}
        onValueChange={setHeld}
        onValueCommit={(next) => void onCommit(next).then(() => setHeld(null))}
      />
      <div className="flex justify-between gap-gap">
        <Text variant="meta" color="muted">
          {low}
        </Text>
        <Text variant="meta" color="muted">
          {high}
        </Text>
      </div>
    </div>
  );
}
