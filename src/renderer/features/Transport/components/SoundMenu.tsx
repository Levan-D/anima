import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Popover } from '@/components/ui/Popover';
import { Text } from '@/components/ui/Text';
import { MuteButton } from '@/features/Transport/components/MuteButton';
import { VolumeSlider } from '@/features/Transport/components/VolumeSlider';

type Props = {
  className?: string;
};

/** Where the volume and mute go in a column too narrow to show them. */
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
          <div className="flex items-center gap-gap">
            <MuteButton />
            <VolumeSlider className="flex-1" />
          </div>
        </div>
      </Popover>
    </div>
  );
}
