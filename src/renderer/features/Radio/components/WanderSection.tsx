import { Slider } from '@/components/ui/Slider';
import { Text } from '@/components/ui/Text';
import type { WanderSlider } from '../hooks/useWanderSlider';

const STEP = 0.05;

export function WanderSection({ wander }: { wander: WanderSlider }) {
  return (
    <section className="flex shrink-0 flex-col gap-1 p-gutter">
      <Text as="h3" variant="meta" color="muted">
        Wander
      </Text>
      <Slider
        label="How far radio may wander"
        min={0}
        max={1}
        step={STEP}
        value={wander.value}
        onValueChange={wander.onChange}
        onValueCommit={wander.onCommit}
      />
      <div className="flex justify-between gap-gap">
        <Text variant="meta" color="muted">
          Same vibe
        </Text>
        <Text variant="meta" color="muted">
          Adventurous
        </Text>
      </div>
    </section>
  );
}
