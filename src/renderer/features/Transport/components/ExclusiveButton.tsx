import { Shield, ShieldOff } from 'lucide-react';
import { IconToggle } from '@/components/ui/IconToggle';
import { goBack } from '@/lib/navigation';
import { setOutputMode } from '@/lib/playerActions';
import { usePlayer } from '@/lib/playerStore';

export function ExclusiveButton() {
  const isOn = usePlayer((state) => state.outputMode === 'exclusive');

  return (
    <IconToggle
      labelOff="Exclusive mode off: Windows mixes this with other apps. Press to give this app the sound device alone, which silences them"
      labelOn="Exclusive mode on: this app has the sound device alone, and other apps stay silent while it holds it. Press to share again"
      isOn={isOn}
      onPressedChange={(next) => setOutputMode(next ? 'exclusive' : 'shared')}
      icon={ShieldOff}
      iconOn={Shield}
      onEscape={goBack}
    />
  );
}
