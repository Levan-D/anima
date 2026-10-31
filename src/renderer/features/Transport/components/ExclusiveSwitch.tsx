import { Switch } from '@/components/ui/Switch';
import { Text } from '@/components/ui/Text';
import { setOutputMode } from '@/lib/playerActions';
import { usePlayer } from '@/lib/playerStore';

type Props = {
  className?: string;
};

/** Cutting off every other app isn't something to do by accident, so the switch says so where it can be read. */
export function ExclusiveSwitch({ className }: Props) {
  const isExclusive = usePlayer((state) => state.outputMode === 'exclusive');

  return (
    <Switch
      checked={isExclusive}
      onCheckedChange={(checked) => setOutputMode(checked ? 'exclusive' : 'shared')}
      {...(className ? { className } : {})}
    >
      <Text variant="meta" color="muted" truncate>
        Exclusive<span className="@max-transport-line:sr-only"> · mutes other apps</span>
      </Text>
    </Switch>
  );
}
