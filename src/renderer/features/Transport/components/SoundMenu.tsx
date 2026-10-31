import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Popover } from '@/components/ui/Popover';
import { Text } from '@/components/ui/Text';
import { ExclusiveSwitch } from '@/features/Transport/components/ExclusiveSwitch';
import { MiniPlayerButton } from '@/features/Transport/components/MiniPlayerButton';
import { SignalDetails } from '@/features/Transport/components/SignalDetails';
import { VolumeSlider } from '@/features/Transport/components/VolumeSlider';

type Props = {
  className?: string;
};

/** Where the volume, the signal and the switch go in a column too narrow to show them. */
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
        className="w-90"
      >
        <div className="flex flex-col">
          <Text variant="meta" color="muted">
            Volume
          </Text>
          <VolumeSlider />
        </div>
        <SignalDetails />
        <ExclusiveSwitch className="justify-between" />
        <div className="flex items-center justify-between gap-gap">
          <Text>Mini player</Text>
          <MiniPlayerButton />
        </div>
      </Popover>
    </div>
  );
}
