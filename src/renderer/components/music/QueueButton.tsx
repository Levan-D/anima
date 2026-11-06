import { ListMusic } from 'lucide-react';
import { IconToggle } from '@/components/ui/IconToggle';
import { goBack } from '@/lib/navigation';
import { closeQueueSheet, setQueueSheetOpen, useQueueSheet } from '@/lib/queueSheet';

export function QueueButton() {
  const isOpen = useQueueSheet();

  return (
    <IconToggle
      labelOff="Queue"
      labelOn="Close queue"
      isOn={isOpen}
      onPressedChange={setQueueSheetOpen}
      icon={ListMusic}
      onEscape={isOpen ? closeQueueSheet : goBack}
      data-queue-button
    />
  );
}
