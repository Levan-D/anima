import { Radio as RadioIcon } from 'lucide-react';
import { IconToggle } from '@/components/ui/IconToggle';
import { Text } from '@/components/ui/Text';
import { goBack } from '@/lib/navigation';
import { setRadio } from '@/lib/playerActions';
import { usePlayer } from '@/lib/playerStore';

/** A placeholder until the real radio mode: the switch, and what it's playing. */
export function Radio() {
  const isOn = usePlayer((state) => state.radio);
  const title = usePlayer((state) => state.current?.title ?? null);
  const artist = usePlayer((state) => state.current?.artist ?? null);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-gap p-gutter text-center">
      <IconToggle
        labelOff="Turn radio on"
        labelOn="Radio is on, turn it off"
        isOn={isOn}
        onPressedChange={setRadio}
        icon={RadioIcon}
        onEscape={goBack}
      />
      <Text as="h1" variant="heading">
        {isOn ? 'Radio is on' : 'Radio is off'}
      </Text>
      <Text color="muted">
        {title === null ? 'Nothing playing' : [title, artist].filter((part) => part !== null).join(' · ')}
      </Text>
    </div>
  );
}
