import { Switch } from '@/components/ui/Switch';
import { Text } from '@/components/ui/Text';
import { setRadio } from '@/lib/playerActions';
import { usePlayer } from '@/lib/playerStore';

export function RadioSwitch() {
  const isOn = usePlayer((state) => state.radio);

  return (
    <Switch checked={isOn} onCheckedChange={setRadio} className="justify-between">
      <Text variant="meta" color="muted" truncate>
        Radio · keeps the queue going
      </Text>
    </Switch>
  );
}
