import type { ReactNode } from 'react';
import { Slider } from '@/components/ui/Slider';
import { Text } from '@/components/ui/Text';
import type { RadioSlider } from '../hooks/useRadioSlider';

const STEP = 0.05;

type Props = {
  title: string;
  label: string;
  low: string;
  high: string;
  slider: RadioSlider;
  disabled?: boolean;
  children?: ReactNode;
};

export function RadioSliderSection({ title, label, low, high, slider, disabled = false, children }: Props) {
  return (
    <section className="flex shrink-0 flex-col gap-1 p-gutter">
      <Text as="h3" variant="meta" color="muted">
        {title}
      </Text>
      <Slider
        label={label}
        min={0}
        max={1}
        step={STEP}
        disabled={disabled}
        value={slider.value}
        onValueChange={slider.onChange}
        onValueCommit={slider.onCommit}
      />
      <div className="flex justify-between gap-gap">
        <Text variant="meta" color="muted">
          {low}
        </Text>
        <Text variant="meta" color="muted">
          {high}
        </Text>
      </div>
      {children}
    </section>
  );
}
