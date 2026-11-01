import { useQuery } from '@tanstack/react-query';
import {
  BREATHER_MAX_DROP,
  BREATHER_MIN_DROP,
  BREATHER_MIN_SONGS,
  BREATHER_NEVER,
  CLIMB_MAX_SONGS,
  RADIO_ENERGY_DEFAULT,
  type RadioEnergy,
} from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Collapse } from '@/components/ui/Collapse';
import { Switch } from '@/components/ui/Switch';
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

type SliderProps = {
  field: Exclude<keyof RadioEnergy, 'isOn'>;
  energy: RadioEnergy;
  title: string;
  description: string;
  label: string;
  low: string;
  high: string;
  min?: number;
  max?: number;
  step?: number;
};

function EnergySlider({ field, energy, ...slider }: SliderProps) {
  const control = useRadioSlider(energy[field], (value) => setRadioEnergy({ ...energy, [field]: value }));
  return <RadioSliderSection {...slider} slider={control} />;
}

function breatherWords(everySongs: number): string {
  return everySongs >= BREATHER_NEVER ? 'A breather: never' : `A breather: about every ${everySongs} songs`;
}

function climbWords(climbSongs: number): string {
  if (climbSongs === 0) return 'Then straight back up';
  return climbSongs === 1 ? 'Then back up over 1 song' : `Then back up over ${climbSongs} songs`;
}

export function EnergySection({ onOpenSettings }: { onOpenSettings: () => void }) {
  const saved = useQuery({ ...settingsQuery, select: (settings) => settings.radioEnergy });
  const energy = saved.data ?? RADIO_ENERGY_DEFAULT;
  const options = useQuery(radioStartOptionsQuery);
  const status = options.data?.energy ?? 'ready';
  const isReady = status === 'ready';

  return (
    <section aria-label="Energy" className="flex shrink-0 flex-col">
      <div className="flex flex-col px-gutter pt-gutter">
        <Switch
          checked={energy.isOn}
          disabled={!isReady}
          onCheckedChange={(isOn) => void setRadioEnergy({ ...energy, isOn })}
        >
          <Text className="min-w-0 flex-1">Energy wave</Text>
        </Switch>
        <Text as="p" variant="meta" color="muted">
          {energy.isOn
            ? 'Stays near what you are listening to, with a breather now and then'
            : 'Off, radio goes by similarity alone'}
        </Text>
      </div>
      <Collapse open={!isReady}>
        <div className="flex flex-wrap items-center gap-x-gap px-gutter py-1">
          <Text variant="meta" color="muted" className="min-w-0 flex-1">
            {isReady ? '' : WHY_OFF[status]}
          </Text>
          {status === 'no-fingerprints' ? (
            <Button variant="ghost" onClick={onOpenSettings}>
              Settings → Data
            </Button>
          ) : null}
        </div>
      </Collapse>
      <Collapse open={isReady && energy.isOn}>
        <EnergySlider
          field="hold"
          energy={energy}
          title="How close songs stay"
          description="How far a normal song can stray from the energy you're on. All the way left, normal songs ignore energy"
          label="How close songs stay to the current energy"
          low="Anything similar"
          high="Very close"
        />
        <EnergySlider
          field="everySongs"
          energy={energy}
          title={breatherWords(energy.everySongs)}
          description="How many songs pass between softer ones. It can run longer when nothing close fits"
          label="How often a breather comes"
          low={`${BREATHER_MIN_SONGS} songs`}
          high="Never"
          min={BREATHER_MIN_SONGS}
          max={BREATHER_NEVER}
          step={1}
        />
        <EnergySlider
          field="drop"
          energy={energy}
          title="How big a breather is"
          description="How much softer that song is than what you've been hearing. Softer means lighter, not always slower"
          label="How far a breather drops"
          low="A little softer"
          high="Much softer"
          min={BREATHER_MIN_DROP}
          max={BREATHER_MAX_DROP}
        />
        <EnergySlider
          field="climbSongs"
          energy={energy}
          title={climbWords(energy.climbSongs)}
          description="How gradually radio gets back to your energy after a breather"
          label="How many songs the climb back takes"
          low="At once"
          high={`${CLIMB_MAX_SONGS} songs`}
          max={CLIMB_MAX_SONGS}
          step={1}
        />
        <EnergySlider
          field="lean"
          energy={energy}
          title="Overall lean"
          description="Nudges every pick softer or harder. The middle doesn't nudge at all"
          label="Whether to lean calmer or more intense"
          low="Calmer"
          high="More intense"
        />
      </Collapse>
    </section>
  );
}
