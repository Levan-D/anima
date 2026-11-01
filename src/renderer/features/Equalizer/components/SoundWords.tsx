import { memo } from 'react';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { SOUND_WORDS, type SoundWord } from '@/features/Equalizer/utils/chartData';
import { spanAt, xOfHz } from '@/features/Equalizer/utils/eqBands';
import { cn } from '@/lib/cn';

const LANE_CLASSES: Record<SoundWord['lane'], string> = { 0: 'bottom-1', 1: 'bottom-7', 2: 'bottom-13' };

// Near the edges a word lines up with its range's own edge, so it stays inside the plot.
const HUG_BELOW = 0.05;
const HUG_ABOVE = 0.95;

function wordClasses(middle: number): string {
  if (middle < HUG_BELOW) return 'left-0';
  if (middle > HUG_ABOVE) return 'right-0';
  return 'left-1/2 -translate-x-1/2';
}

/** Each word over a line as wide as its range. Under the nodes in the page's order, so a drag always gets the node. */
export const SoundWords = memo(function SoundWords() {
  return SOUND_WORDS.map(({ name, note, range: [low, high], lane }) => {
    const from = xOfHz(low);
    const to = xOfHz(high);
    return (
      <div key={name} className={cn('pointer-events-none absolute h-4', LANE_CLASSES[lane])} style={spanAt(low, high)}>
        <span className="absolute inset-x-0 bottom-0 border-b border-eq-line-major" />
        <Tooltip label={note} opensOnTap>
          <Button
            variant="mark"
            size="mark"
            className={cn('pointer-events-auto absolute bottom-0.5', wordClasses((from + to) / 2))}
          >
            {name}
          </Button>
        </Tooltip>
      </div>
    );
  });
});
