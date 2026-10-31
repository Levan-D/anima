import { Button } from '@/components/ui/Button';
import { Popover } from '@/components/ui/Popover';
import { Text } from '@/components/ui/Text';
import { SignalDetails } from '@/features/Transport/components/SignalDetails';
import { formatLine, signalLine, signalNote, uncountedAlterations } from '@/features/Transport/utils/signalWords';
import { cn } from '@/lib/cn';
import { usePlayer } from '@/lib/playerStore';

type Props = {
  className?: string;
};

/** One line of what the file is and what's happening to it, which narrowest says only the first. The rest of it is a tap or a key away. */
export function SignalStatus({ className }: Props) {
  const line = usePlayer(signalLine);
  const format = usePlayer(formatLine);
  const note = usePlayer(signalNote);
  const more = usePlayer(uncountedAlterations);

  if (line === null) return <span className={cn('min-w-0', className)} />;

  return (
    <div className={className}>
      <Popover
        label="Signal"
        trigger={
          <Button
            variant="quiet"
            size="bare"
            aria-label={`Signal: ${line}`}
            data-testid="signal-status"
            className="min-w-0 shrink [&>span]:min-w-0"
          >
            <Text variant="meta" color="inherit" tabular truncate>
              {format}
              {note === null ? null : <span className="@max-transport-note:hidden"> · {note}</span>}
              {more > 0 ? <span className="hidden @transport-line:inline"> +{more}</span> : null}
            </Text>
          </Button>
        }
        align="start"
        className="w-90"
      >
        <SignalDetails />
      </Popover>
    </div>
  );
}
