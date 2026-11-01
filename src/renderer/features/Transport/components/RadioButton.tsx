import { Radio } from 'lucide-react';
import { IconToggle } from '@/components/ui/IconToggle';
import { goBack } from '@/lib/navigation';
import { setRadio } from '@/lib/playerActions';
import { usePlayer } from '@/lib/playerStore';

export function RadioButton() {
  const isOn = usePlayer((state) => state.radio);

  return (
    <IconToggle
      labelOff="Turn radio on"
      labelOn="Radio is on, turn it off"
      isOn={isOn}
      onPressedChange={setRadio}
      icon={Radio}
      onEscape={goBack}
    />
  );
}
