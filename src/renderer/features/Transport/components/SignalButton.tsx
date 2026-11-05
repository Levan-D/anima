import type { SignalKind } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { Popover } from '@/components/ui/Popover';
import { Text } from '@/components/ui/Text';
import { Tooltip } from '@/components/ui/Tooltip';
import { formatLine, shortFormat, signalLabel, SIGNAL_LEGEND } from '@/features/Transport/utils/signalWords';
import { cn } from '@/lib/cn';
import { goBack } from '@/lib/navigation';
import { usePlayer } from '@/lib/playerStore';

const DOT_COLORS: Record<SignalKind, string> = {
  'bit-perfect': 'bg-signal-perfect',
  adjusted: 'bg-signal-adjusted',
  system: 'bg-signal-system',
};

type DotProps = {
  kind: SignalKind;
};

function Dot({ kind }: DotProps) {
  return <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', DOT_COLORS[kind])} />;
}

function Verdict() {
  const kind = usePlayer((state) => state.signal.kind);
  const alterations = usePlayer((state) => state.signal.alterations);

  if (kind === null) return <Text color="muted">Waiting for the signal, which shows once the track plays</Text>;
  if (kind === 'bit-perfect') return <Text>Bit-perfect: nothing in this app is changing the signal</Text>;

  return (
    <div className="flex flex-col">
      <Text>Not bit-perfect</Text>
      <ul className="flex flex-col">
        {alterations.map((alteration) => (
          <li key={alteration}>
            <Text variant="meta" color="muted">
              {alteration}
            </Text>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Legend() {
  const current = usePlayer((state) => state.signal.kind);

  return (
    <>
      <Divider />
      <ul aria-label="What the dot's colors mean" className="flex flex-col gap-1">
        {SIGNAL_LEGEND.map(({ kind, name, meaning }) => {
          const isCurrent = kind === current;
          return (
            <li key={kind} aria-current={isCurrent || undefined} className="flex items-baseline gap-2">
              <Dot kind={kind} />
              <div className="flex min-w-0 flex-1 flex-col">
                <Text variant="meta" color={isCurrent ? 'default' : 'muted'}>
                  {name}
                </Text>
                <Text variant="meta" color="faint">
                  {meaning}
                </Text>
              </div>
              {isCurrent ? <Text variant="label">Now</Text> : null}
            </li>
          );
        })}
      </ul>
      <Text as="p" variant="meta" color="faint">
        Windows' own effects and what your device does can't be seen from here
      </Text>
    </>
  );
}

type Props = {
  className?: string;
};

/** What's playing and how clean the signal is, as briefly as can be. The whole of it is a press away. */
export function SignalButton({ className }: Props) {
  const short = usePlayer(shortFormat);
  const full = usePlayer(formatLine);
  const kind = usePlayer((state) => state.signal.kind);

  if (short === null) return null;

  return (
    <div className={cn('flex min-w-0', className)}>
      <Popover
        label="Signal"
        trigger={
          <Tooltip label="Signal details" onEscape={goBack}>
            <Button
              variant="quiet"
              size="bare"
              aria-label={signalLabel(short, kind)}
              data-testid="signal-status"
              className="min-w-0 shrink [&>span]:min-w-0 [&>span]:gap-1.5"
            >
              <Text variant="micro" color="inherit" tabular truncate>
                {short}
              </Text>
              {kind === null ? null : <Dot kind={kind} />}
            </Button>
          </Tooltip>
        }
        align="start"
        className="w-90"
      >
        <div data-testid="signal-details" className="flex flex-col gap-3">
          <Text tabular>{full}</Text>
          <Verdict />
          <Legend />
        </div>
      </Popover>
    </div>
  );
}
