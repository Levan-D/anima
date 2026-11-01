import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Popover } from '@/components/ui/Popover';
import { Text } from '@/components/ui/Text';
import { VolumeSlider } from '@/features/Transport/components/VolumeSlider';

type Props = {
  className?: string;
};

/** Where the volume goes in a column too narrow to show it. */
export function SoundMenu({ className }: Props) {
  return (
    <div className={className}>
      <Popover
        label="Sound"
        trigger={
          <Button variant="ghost" size="icon" aria-label="Sound">
            <SlidersHorizontal aria-hidden />
          </Button>
        }
        className="w-70"
      >
        <div className="flex flex-col">
          <Text variant="meta" color="muted">
            Volume
          </Text>
          <VolumeSlider />
        </div>
      </Popover>
    </div>
  );
}
