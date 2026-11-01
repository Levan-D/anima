import { useQuery } from '@tanstack/react-query';
import { STAY_AWAKE_DEFAULT, STAY_AWAKE_MODES, type StayAwake, type StayAwakeMode } from '@shared/domain';
import { ModalSection } from '@/components/ui/ModalSection';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Text } from '@/components/ui/Text';
import { call } from '@/lib/api';
import { settingsQuery } from '@/lib/libraryQueries';

const MODE_WORDS: Record<StayAwakeMode, string> = {
  off: 'Off',
  'keep-running': 'Keep running',
  'screen-on': 'Screen on',
};
const MODE_ITEMS = STAY_AWAKE_MODES.map((value) => ({ value, label: MODE_WORDS[value] }));

const ROWS: readonly { key: keyof StayAwake; label: string }[] = [
  { key: 'pluggedIn', label: 'Plugged in' },
  { key: 'onBattery', label: 'On battery' },
];

export function StayAwakeSection() {
  const { data: stayAwake = STAY_AWAKE_DEFAULT } = useQuery({
    ...settingsQuery,
    select: (settings) => settings.stayAwake,
  });

  return (
    <ModalSection title="Stay awake">
      {ROWS.map(({ key, label }) => (
        <div key={key} className="flex flex-wrap items-center justify-between gap-2">
          <Text>{label}</Text>
          <SegmentedControl
            label={label}
            items={MODE_ITEMS}
            value={stayAwake[key]}
            onValueChange={(mode) => void call('settings.update', { stayAwake: { ...stayAwake, [key]: mode } })}
          />
        </div>
      ))}
      <Text as="p" variant="meta" color="muted">
        Holds while music is playing
      </Text>
    </ModalSection>
  );
}
