import { Headphones as HeadphonesIcon, Plus, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import {
  EQ_AUTO_PREAMP,
  EQ_MAX_BANDS,
  EQ_MAX_GAIN_DB,
  type EqBand,
  type EqLayers,
  type EqSettings,
} from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Collapse } from '@/components/ui/Collapse';
import { Fade } from '@/components/ui/Fade';
import { Modal } from '@/components/ui/Modal';
import { Switch } from '@/components/ui/Switch';
import { Text } from '@/components/ui/Text';
import { Tooltip } from '@/components/ui/Tooltip';
import { BandEditor } from '@/features/Equalizer/components/BandEditor';
import { HeadphoneOverlay } from '@/features/Equalizer/components/HeadphoneOverlay';
import { HeadphoneTools } from '@/features/Equalizer/components/HeadphoneTools';
import { InstrumentChart } from '@/features/Equalizer/components/InstrumentChart';
import { PreampControl } from '@/features/Equalizer/components/PreampControl';
import { PresetBar } from '@/features/Equalizer/components/PresetBar';
import { ResponseCurve } from '@/features/Equalizer/components/ResponseCurve';
import { useEqCompare, type EqCompare } from '@/features/Equalizer/hooks/useEqCompare';
import { useEqDraft } from '@/features/Equalizer/hooks/useEqDraft';
import { useEqHistory } from '@/features/Equalizer/hooks/useEqHistory';
import { useEqLayers } from '@/features/Equalizer/hooks/useEqLayers';
import { useHeadphones } from '@/features/Equalizer/hooks/useHeadphones';
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
  'Each line joins pure tones that sound equally loud, at two listening levels named in phon. A guide to hearing, not a target for the EQ. The ear is keenest around 3 kHz and needs far more level at the extremes to call them equally loud. The lines flatten as it gets louder, so turning down seems to take the bass and treble with it. Levels are dB SPL, on the right.';

const WHEEL_Q_OCTAVES = 1 / 8;

const ADD_BAND_NOTE =
  'One more point on the curve. Double click the plot to add one there, scroll on a point to change its width, right click to remove it';
const HEADPHONES_NOTE = "Compare a headphone's measured response with your EQ";

const LAYER_SWITCHES: { layer: keyof EqLayers; words: string; hint: string }[] = [
  {
    layer: 'words',
    words: 'Sound words',
    hint: 'Everyday names for parts of the range, on the plot. Point at one for what it does',
  },
  { layer: 'instruments', words: 'Instruments', hint: 'Where each instrument sits in the range, under the plot' },
  { layer: 'ear', words: 'Ear sensitivity', hint: 'How sensitive hearing is across the range, drawn on the plot' },
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
  compare: EqCompare;
};

function EqualizerContents({ eq, edit, endGroup, compare }: ContentsProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [highlighted, setHighlighted] = useState<Instrument | null>(null);
  const { layers, setLayer } = useEqLayers();
  const sampleRate = usePlayer(curveRateOf);
  const headphones = useHeadphones();
  const { lines, target, match, state } = headphones;
  const areToolsOpen = state?.options.isOpen ?? false;
  const rangeDb = lines?.rangeDb ?? EQ_MAX_GAIN_DB;

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
    if (bands.length < EQ_MAX_BANDS) addBand(bandAtPoint(bands, x, y, sampleRate, rangeDb));
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
          <Tooltip label={ADD_BAND_NOTE}>
            <Button
              variant="outline"
              size="sm"
              disabled={bands.length >= EQ_MAX_BANDS}
              onClick={() => addBand(newBand(bands))}
            >
              <Plus aria-hidden />
              Add band
            </Button>
          </Tooltip>
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
        rangeDb={rangeDb}
        overlay={
          lines === null ? null : (
            <HeadphoneOverlay
              lines={lines}
              bands={bands}
              sampleRate={sampleRate}
              showPredicted={eq.enabled}
              isTargetApproximate={match === 'approximate'}
              zeroWords={lines.isDifference && target !== null ? `0 is ${target.name}` : null}
            />
          )
        }
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

      <Collapse open={layers.instruments} grow={1.4} className="mx-7 mb-1 flex min-h-0 basis-0">
        <InstrumentChart highlighted={highlighted} onHighlight={setHighlighted} className="w-full" />
      </Collapse>

      <div className="flex shrink-0 flex-wrap items-center gap-x-gap">
        {LAYER_SWITCHES.map(({ layer, words, hint }) => (
          <Switch key={layer} checked={layers[layer]} onCheckedChange={(isOn) => setLayer(layer, isOn)}>
            <Tooltip label={hint}>
              <Text variant="meta" color="muted">
                {words}
              </Text>
            </Tooltip>
          </Switch>
        ))}
        <Tooltip label={HEADPHONES_NOTE}>
          <Button
            variant={areToolsOpen ? 'outline' : 'ghost'}
            size="sm"
            aria-pressed={areToolsOpen}
            data-testid="hp-open"
            onClick={() => headphones.setOption({ isOpen: !areToolsOpen })}
          >
            <HeadphonesIcon aria-hidden />
            Headphones
          </Button>
        </Tooltip>
        <Text variant="meta" color="faint" className="ml-auto">
          {CHART_CREDIT}
        </Text>
      </div>
      <Collapse open={layers.ear} className="shrink-0">
        <Text as="p" variant="meta" color="muted" className="mb-2">
          {EAR_NOTE}
        </Text>
      </Collapse>

      <Collapse open={areToolsOpen} className="shrink-0">
        <HeadphoneTools
          headphones={headphones}
          eq={eq}
          sampleRate={sampleRate}
          compare={compare}
          className="mb-2 flex flex-col gap-1"
        />
      </Collapse>

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
  const sampleRate = usePlayer(curveRateOf);
  const live = useEqHistory(isOpen, latest, change);
  const compare = useEqCompare(isOpen, eq, sampleRate);
  // Main has the off side while it's held, and the screen stays on what's being compared. Nothing edits it meanwhile.
  const shown = compare.frozen ?? eq;
  const edit: typeof live.edit = (next, group) => {
    if (!compare.isComparing) live.edit(next, group);
  };
  const { endGroup } = live;

  return (
    <Modal
      open={isOpen}
      onOpenChange={setEqualizerOpen}
      title="Equalizer"
      titleAside={
        <div className="flex min-w-0 flex-1 items-center justify-between gap-gap">
          <div className="flex min-w-0 items-center gap-gap">
            <Switch
              checked={shown.enabled}
              onCheckedChange={(enabled) => edit({ ...shown, enabled })}
              className="-my-2"
            >
              <span className="sr-only">Equalizer on</span>
            </Switch>
            <Fade show={!shown.enabled} className="flex min-w-0">
              <Text variant="meta" color="muted" className="min-w-0 truncate">
                {IS_OFF}
              </Text>
            </Fade>
          </div>
          <PreampControl eq={shown} onChange={(preamp) => edit({ ...shown, preamp })} />
        </div>
      }
      closeLabel="Close equalizer"
      size="tall"
      onOpenAutoFocus={focusFirstNode}
    >
      <EqualizerContents eq={shown} edit={edit} endGroup={endGroup} compare={compare} />
    </Modal>
  );
}
