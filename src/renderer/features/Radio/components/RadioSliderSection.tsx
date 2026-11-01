import type { ReactNode } from 'react';
import { Slider } from '@/components/ui/Slider';
import { Text } from '@/components/ui/Text';
import type { RadioSlider } from '../hooks/useRadioSlider';

const STEP = 0.05;

type Props = {
  title: string;
  description: string;
  label: string;
  low: string;
  high: string;
  slider: RadioSlider;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  children?: ReactNode;
};

export function RadioSliderSection({
  title,
  description,
  label,
  low,
  high,
  slider,
  min = 0,
  max = 1,
  step = STEP,
  disabled = false,
  children,
}: Props) {
  return (
    <section className="flex shrink-0 flex-col gap-1 p-gutter">
      <Text as="h3">{title}</Text>
      <Text as="p" variant="meta" color="muted">
        {description}
      </Text>
      <Slider
        label={label}
        min={min}
        max={max}
        step={step}
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
