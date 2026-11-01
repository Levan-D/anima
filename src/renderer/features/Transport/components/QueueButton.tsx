import { ListMusic } from 'lucide-react';
import { IconToggle } from '@/components/ui/IconToggle';
import { goBack, showingQueue, toggleQueue, useNavigation } from '@/lib/navigation';
import { usePage } from '@/lib/pages';

export function QueueButton() {
  const isQueueUp = useNavigation(showingQueue);
  const isShowing = usePage() === 'library' && isQueueUp;

  return (
    <IconToggle
      labelOff="Queue"
      labelOn="Queue"
      isOn={isShowing}
      onPressedChange={toggleQueue}
      icon={ListMusic}
      onEscape={goBack}
    />
  );
}
