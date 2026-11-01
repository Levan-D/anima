import { Zap, ZapOff } from 'lucide-react';
import { IconToggle } from '@/components/ui/IconToggle';
import { goBack } from '@/lib/navigation';
import { setOutputMode } from '@/lib/playerActions';
import { usePlayer } from '@/lib/playerStore';

export function ExclusiveButton() {
  const isOn = usePlayer((state) => state.outputMode === 'exclusive');

  return (
    <IconToggle
      labelOff="Exclusive mode: mutes other apps while on"
      labelOn="Exclusive mode is on, other apps are muted"
      isOn={isOn}
      onPressedChange={(next) => setOutputMode(next ? 'exclusive' : 'shared')}
      icon={ZapOff}
      iconOn={Zap}
      onEscape={goBack}
    />
  );
}
