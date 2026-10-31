import { Text } from '@/components/ui/Text';
import { fromFileWords, toDeviceWords } from '@/features/Transport/utils/signalWords';
import { usePlayer } from '@/lib/playerStore';

type RowProps = {
  label: string;
  value: string;
};

function Row({ label, value }: RowProps) {
  return (
    <div className="flex flex-col">
      <Text variant="meta" color="muted">
        {label}
      </Text>
      <Text tabular>{value}</Text>
    </div>
  );
}

/** The whole of what's happening to the signal, in plain words. */
export function SignalDetails() {
  const { decoded, output, isBitPerfect, alterations } = usePlayer((state) => state.signal);
  const track = usePlayer((state) => state.current);

  if (track === null || decoded === null || output === null) {
    return (
      <Text as="p" color="muted">
        Nothing is playing
      </Text>
    );
  }

  return (
    <div data-testid="signal-details" className="flex flex-col gap-2">
      <Row label="From the file" value={fromFileWords(track, decoded)} />
      <Row label="To the device" value={toDeviceWords(output)} />
      {isBitPerfect ? (
        <Text as="p">Bit-perfect: nothing is changing the signal</Text>
      ) : (
        <div className="flex flex-col">
          <Text variant="meta" color="muted">
            What&apos;s changing it
          </Text>
          <ul className="flex flex-col">
            {alterations.map((alteration) => (
              <li key={alteration}>
                <Text>{alteration}</Text>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
