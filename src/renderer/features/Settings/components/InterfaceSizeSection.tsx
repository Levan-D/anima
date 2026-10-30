import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { UI_SCALE_MAX, UI_SCALE_MIN } from '@shared/domain';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Slider } from '@/components/ui/Slider';
import { Text } from '@/components/ui/Text';
import { Section } from '@/features/Settings/components/Section';
import { useStaysInView } from '@/hooks/useStaysInView';
import { settingsQuery } from '@/lib/libraryQueries';
import { setInterfaceSize, useWindowScaleLimit } from '@/lib/uiScale';

const STEP = 0.05;

const percent = (scale: number) => `${Math.round(scale * 100)}%`;

type SizeSliderProps = {
  saved: number;
};

function SizeSlider({ saved }: SizeSliderProps) {
  // A drag or a held key can outrun the round trip to main, and the next step has to start from the last one.
  const [moved, setMoved] = useState<number | null>(null);
  const value = moved ?? saved;
  const limit = useWindowScaleLimit();
  const isLimited = value > limit;
  const rowRef = useStaysInView<HTMLDivElement>(saved);

  return (
    <>
      <div ref={rowRef} className="flex items-center gap-gap">
        {/* Applied when the drag ends: everything resizes, and the thumb would move out from under the pointer. */}
        <Slider
          label="Interface size"
          min={UI_SCALE_MIN}
          max={UI_SCALE_MAX}
          step={STEP}
          value={value}
          onValueChange={setMoved}
          onValueCommit={setInterfaceSize}
          className="min-w-0 flex-1"
        />
        <Text tabular className="w-12 shrink-0">
          {percent(value)}
        </Text>
      </div>
      {isLimited ? (
        <Text as="p" variant="meta" color="muted">
          This window only has room for {percent(limit)}. It goes higher in a bigger one
        </Text>
      ) : null}
    </>
  );
}

function SizeControl() {
  const settings = useQuery(settingsQuery);

  if (settings.isPending) return <Skeleton className="h-tap w-full animate-appear-late" />;
  if (settings.isError) return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  return <SizeSlider saved={settings.data.uiScale} />;
}

export function InterfaceSizeSection() {
  return (
    <Section title="Interface size">
      <SizeControl />
    </Section>
  );
}
