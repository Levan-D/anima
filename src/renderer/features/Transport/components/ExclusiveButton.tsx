import { Shield, ShieldOff } from 'lucide-react';
import { IconToggle } from '@/components/ui/IconToggle';
import { goBack } from '@/lib/navigation';
import { setOutputMode } from '@/lib/playerActions';
import { usePlayer } from '@/lib/playerStore';

export function ExclusiveButton() {
  const isOn = usePlayer((state) => state.outputMode === 'exclusive');

  return (
    <IconToggle
      labelOff="Exclusive mode off"
      labelOn="Exclusive mode on"
      isOn={isOn}
      onPressedChange={(next) => setOutputMode(next ? 'exclusive' : 'shared')}
      icon={ShieldOff}
      iconOn={Shield}
      onEscape={goBack}
    />
  );
}
