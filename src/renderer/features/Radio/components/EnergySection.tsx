import { useQuery } from '@tanstack/react-query';
import { ENERGY_MIDDLE } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Collapse } from '@/components/ui/Collapse';
import { Text } from '@/components/ui/Text';
import { settingsQuery } from '@/lib/libraryQueries';
import { setRadioEnergy } from '@/lib/playerActions';
import { radioStartOptionsQuery } from '@/lib/playerQueries';
import { useRadioSlider } from '../hooks/useRadioSlider';
import { RadioSliderSection } from './RadioSliderSection';

const WHY_OFF = {
  'no-models':
    'The energy models are missing, so radio goes by similarity alone. Run npm run fetch:binaries, or reinstall',
  'no-fingerprints': 'Radio needs fingerprints to tell calmer from more intense',
  failed: "The energy models wouldn't load, so radio goes by similarity alone",
} as const;

export function EnergySection({ onOpenSettings }: { onOpenSettings: () => void }) {
  const saved = useQuery({ ...settingsQuery, select: (settings) => settings.radioEnergy });
  const slider = useRadioSlider(saved.data ?? ENERGY_MIDDLE, setRadioEnergy);
  const options = useQuery(radioStartOptionsQuery);
  const status = options.data?.energy ?? 'ready';

  return (
    <RadioSliderSection
      title="Energy"
      label="How calm or intense radio should be"
      low="Calmer"
      high="More intense"
      slider={slider}
      disabled={status !== 'ready'}
    >
      <Collapse open={status !== 'ready'}>
        <div className="flex flex-wrap items-center gap-x-gap">
          <Text variant="meta" color="muted" className="min-w-0 flex-1">
            {status === 'ready' ? '' : WHY_OFF[status]}
          </Text>
          {status === 'no-fingerprints' ? (
            <Button variant="ghost" onClick={onOpenSettings}>
              Settings → Data
            </Button>
          ) : null}
        </div>
      </Collapse>
    </RadioSliderSection>
  );
}
