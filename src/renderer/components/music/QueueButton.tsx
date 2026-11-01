import { ListMusic } from 'lucide-react';
import { IconToggle } from '@/components/ui/IconToggle';
import { goBack } from '@/lib/navigation';
import { closeQueueSheet, setQueueSheetOpen, useQueueSheet } from '@/lib/queueSheet';

type Props = {
  /** What Escape does as well while the queue is closed. */
  onEscape?: () => void;
  tooltipSide?: 'top' | 'left';
};

export function QueueButton({ onEscape = goBack, tooltipSide = 'top' }: Props) {
  const isOpen = useQueueSheet();

  return (
    <IconToggle
      labelOff="Queue"
      labelOn="Close queue"
      isOn={isOpen}
      onPressedChange={setQueueSheetOpen}
      icon={ListMusic}
      onEscape={isOpen ? closeQueueSheet : onEscape}
      tooltipSide={tooltipSide}
      data-queue-button
    />
  );
}
