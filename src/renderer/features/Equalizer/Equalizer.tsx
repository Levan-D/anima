import { Plus, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { EQ_AUTO_PREAMP, EQ_MAX_BANDS, type EqBand, type EqLayers, type EqSettings } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Switch } from '@/components/ui/Switch';
import { Text } from '@/components/ui/Text';
import { BandEditor } from '@/features/Equalizer/components/BandEditor';
import { InstrumentChart } from '@/features/Equalizer/components/InstrumentChart';
import { PreampControl } from '@/features/Equalizer/components/PreampControl';
import { PresetBar } from '@/features/Equalizer/components/PresetBar';
import { ResponseCurve } from '@/features/Equalizer/components/ResponseCurve';
import { useEqDraft } from '@/features/Equalizer/hooks/useEqDraft';
import { useEqHistory } from '@/features/Equalizer/hooks/useEqHistory';
import { useEqLayers } from '@/features/Equalizer/hooks/useEqLayers';
import { CHART_CREDIT, instrumentSpan, type Instrument } from '@/features/Equalizer/utils/chartData';
import {
  bandAtPoint,
  bandNumbers,
  curveRateOf,
  DEFAULT_BANDS,
  isFlat,
  newBand,
  stepQ,
} from '@/features/Equalizer/utils/eqBands';
import { setEqualizerOpen, useEqualizerDialog } from '@/lib/equalizerDialog';
import { usePlayer } from '@/lib/playerStore';

const NOTHING_YET = 'Drag a point to shape the sound';
const IS_OFF = 'Off, so the sound is untouched';
const EAR_NOTE =
  'The ear is keenest around 3 kHz and needs far more level at the extremes to call them equally loud. The lines flatten as it gets louder, so turning down seems to take the bass and treble with it. Levels are dB SPL, on the right.';

const WHEEL_Q_OCTAVES = 1 / 8;

const LAYER_SWITCHES: { layer: keyof EqLayers; words: string }[] = [
  { layer: 'words', words: 'Sound words' },
  { layer: 'instruments', words: 'Instruments' },
  { layer: 'ear', words: 'Ear sensitivity' },
];

// So the arrows work on a node straight away.
function focusFirstNode(event: Event): void {
  if (!(event.currentTarget instanceof Element)) return;
  const node = event.currentTarget.querySelector('[role="slider"]');
  if (!(node instanceof HTMLElement)) return;
  event.preventDefault();
  node.focus();
}

type ContentsProps = {
  eq: EqSettings;
  edit: (next: EqSettings, group?: string | null) => void;
  endGroup: () => void;
};

function EqualizerContents({ eq, edit, endGroup }: ContentsProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [highlighted, setHighlighted] = useState<Instrument | null>(null);
  const { layers, setLayer } = useEqLayers();
  const sampleRate = usePlayer(curveRateOf);

  // No bands saved means it has never been touched. These only become real with the first change, which also turns it on.
  const isUntouched = eq.bands.length === 0;
  const bands = isUntouched ? DEFAULT_BANDS : eq.bands;
  const selected = bands.find(({ id }) => id === selectedId) ?? bands[0] ?? null;
  const selectedNumber = selected === null ? 0 : (bandNumbers(bands).get(selected.id) ?? 0);

  function setBands(next: readonly EqBand[], group: string | null = null): void {
    edit({ ...eq, enabled: isUntouched || eq.enabled, bands: [...next] }, group);
  }

  function changeBand(band: EqBand, group: string | null = null): void {
    setBands(
      bands.map((other) => (other.id === band.id ? band : other)),
      group,
    );
  }

  function addBand(band: EqBand): void {
    setSelectedId(band.id);
    setBands([...bands, band]);
  }

  function removeBand(id: number): void {
    if (bands.length > 1) setBands(bands.filter((band) => band.id !== id));
  }

  function addAt(x: number, y: number): void {
    if (bands.length < EQ_MAX_BANDS) addBand(bandAtPoint(bands, x, y, sampleRate));
  }

  function wheelQ(id: number, isUp: boolean): void {
    const band = bands.find((other) => other.id === id);
    if (band === undefined) return;
    setSelectedId(id);
    changeBand({ ...band, q: stepQ(band.q, isUp ? WHEEL_Q_OCTAVES : -WHEEL_Q_OCTAVES) }, `q-${id}`);
  }

  return (
    <div data-testid="equalizer" className="flex min-h-0 flex-1 flex-col overflow-y-auto p-section">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-gap gap-y-2">
        <PresetBar eq={eq} />
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={bands.length >= EQ_MAX_BANDS}
            onClick={() => addBand(newBand(bands))}
          >
            <Plus aria-hidden />
            Add band
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isUntouched && eq.preamp.auto}
            onClick={() => edit({ enabled: eq.enabled, bands: [], preamp: EQ_AUTO_PREAMP })}
          >
            <RotateCcw aria-hidden />
            Reset
          </Button>
        </div>
      </div>

      {/* The margins hold the zones' names, the frequencies, and the two level scales, with half a node at either end. */}
      <ResponseCurve
        bands={bands}
        sampleRate={sampleRate}
        isOn={eq.enabled}
        hint={isFlat(bands) ? NOTHING_YET : null}
        selectedId={selected?.id ?? null}
        showWords={layers.words}
        showEar={layers.ear}
        highlight={highlighted === null ? null : instrumentSpan(highlighted)}
        onSelect={setSelectedId}
        onChange={changeBand}
        onDragEnd={endGroup}
        onRemove={removeBand}
        onAdd={addAt}
        onWheelNode={wheelQ}
        className="mx-7 mt-6 mb-6 min-h-40 flex-1"
      />

      {layers.instruments ? (
        <InstrumentChart highlighted={highlighted} onHighlight={setHighlighted} className="mx-7 mb-1 flex-[1.4]" />
      ) : null}

      <div className="flex shrink-0 flex-wrap items-center gap-x-gap">
        {LAYER_SWITCHES.map(({ layer, words }) => (
          <Switch key={layer} checked={layers[layer]} onCheckedChange={(isOn) => setLayer(layer, isOn)}>
            <Text variant="meta" color="muted">
              {words}
            </Text>
          </Switch>
        ))}
        <Text variant="meta" color="faint" className="ml-auto">
          {CHART_CREDIT}
        </Text>
      </div>
      {layers.ear ? (
        <Text as="p" variant="meta" color="muted" className="mb-2 shrink-0">
          {EAR_NOTE}
        </Text>
      ) : null}

      {selected === null ? null : (
        <BandEditor
          band={selected}
          sampleRate={sampleRate}
          number={selectedNumber}
          canRemove={bands.length > 1}
          onChange={changeBand}
          onRemove={() => removeBand(selected.id)}
        />
      )}
    </div>
  );
}

/** A tap on the plot's background doesn't do anything: a finger that just misses a node would otherwise. */
export function Equalizer() {
  const isOpen = useEqualizerDialog();
  const { eq, change, latest } = useEqDraft();
  const { edit, endGroup } = useEqHistory(isOpen, latest, change);

  return (
    <Modal
      open={isOpen}
      onOpenChange={setEqualizerOpen}
      title="Equalizer"
      titleAside={
        <div className="flex min-w-0 flex-1 items-center justify-between gap-gap">
          <div className="flex min-w-0 items-center gap-gap">
            <Switch checked={eq.enabled} onCheckedChange={(enabled) => edit({ ...eq, enabled })} className="-my-2">
              <span className="sr-only">Equalizer on</span>
            </Switch>
            {eq.enabled ? null : (
              <Text variant="meta" color="muted" className="min-w-0 truncate">
                {IS_OFF}
              </Text>
            )}
          </div>
          <PreampControl eq={eq} onChange={(preamp) => edit({ ...eq, preamp })} />
        </div>
      }
      closeLabel="Close equalizer"
      size="tall"
      onOpenAutoFocus={focusFirstNode}
    >
      {isOpen ? <EqualizerContents eq={eq} edit={edit} endGroup={endGroup} /> : null}
    </Modal>
  );
}
