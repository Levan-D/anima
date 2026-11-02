import {
  Ear,
  Guitar,
  Headphones as HeadphonesIcon,
  MessageSquareText,
  Plus,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react';
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
import { Divider } from '@/components/ui/Divider';
import { Modal } from '@/components/ui/Modal';
import { Tooltip } from '@/components/ui/Tooltip';
import { BandEditor } from '@/features/Equalizer/components/BandEditor';
import { HeadphoneOverlay } from '@/features/Equalizer/components/HeadphoneOverlay';
import { HeadphoneTools } from '@/features/Equalizer/components/HeadphoneTools';
import { InstrumentChart } from '@/features/Equalizer/components/InstrumentChart';
import { PreampControl } from '@/features/Equalizer/components/PreampControl';
import { PresetBar, PresetSaveButtons } from '@/features/Equalizer/components/PresetBar';
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
import { cn } from '@/lib/cn';
import { setEqualizerOpen, useEqualizerDialog } from '@/lib/equalizerDialog';
import { usePlayer } from '@/lib/playerStore';

const NOTHING_YET =
  'Drag a point to shape the sound. Double click to add one, scroll on one to change its width, right click to remove it';
const EAR_NOTE =
  "Your ears don't hear every pitch equally well. Along each dashed line, every pitch sounds equally loud, so where a line is high, your ears need more volume to hear it as well. They're sharpest around 3 kHz and weakest in deep bass. The two lines are a quieter and a louder listening level, and the gap shows why bass and treble seem to fade when you turn music down. It's a guide to hearing, not a shape to copy with the EQ.";

const WHEEL_Q_OCTAVES = 1 / 8;

const HEADPHONES_NOTE = 'Compare a headphone with your EQ';

// Ghost has no border and outline does, so without this a toggle changes width.
const SAME_WIDTH_AS_ON = 'border border-transparent';

const LAYER_SWITCHES: { layer: keyof EqLayers; icon: LucideIcon; words: string; hint: string }[] = [
  {
    layer: 'words',
    icon: MessageSquareText,
    words: 'Sound words',
    hint: `Everyday names for parts of the range. ${CHART_CREDIT}`,
  },
  { layer: 'instruments', icon: Guitar, words: 'Instruments', hint: 'Where each instrument sits in the range' },
  { layer: 'ear', icon: Ear, words: 'Ear sensitivity', hint: EAR_NOTE },
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

  // No bands saved means it's on no curve at all. These only become real with the first change, which also turns it on.
  const isUntouched = eq.bands.length === 0;
  const bands = isUntouched ? DEFAULT_BANDS : eq.bands;
  const selected = bands.find(({ id }) => id === selectedId) ?? bands[0] ?? null;
  const selectedNumber = selected === null ? 0 : (bandNumbers(bands).get(selected.id) ?? 0);

  function setBands(next: readonly EqBand[], group: string | null = null): void {
    edit({ ...eq, enabled: true, bands: [...next] }, group);
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
    <div data-testid="equalizer" className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto p-section">
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2">
        {LAYER_SWITCHES.map(({ layer, icon: Icon, words, hint }) => (
          <Tooltip key={layer} label={hint}>
            <Button
              variant={layers[layer] ? 'outline' : 'ghost'}
              size="sm"
              aria-pressed={layers[layer]}
              className={cn(!layers[layer] && SAME_WIDTH_AS_ON)}
              onClick={() => setLayer(layer, !layers[layer])}
            >
              <Icon aria-hidden />
              {words}
            </Button>
          </Tooltip>
        ))}
        <Tooltip label={HEADPHONES_NOTE}>
          <Button
            variant={areToolsOpen ? 'outline' : 'ghost'}
            size="sm"
            aria-pressed={areToolsOpen}
            className={cn(!areToolsOpen && SAME_WIDTH_AS_ON)}
            data-testid="hp-open"
            onClick={() => headphones.setOption({ isOpen: !areToolsOpen })}
          >
            <HeadphonesIcon aria-hidden />
            Headphones
          </Button>
        </Tooltip>
        <Button
          variant="ghost"
          size="sm"
          disabled={isUntouched && eq.preamp.auto}
          onClick={() => edit({ enabled: eq.enabled, bands: [], preamp: EQ_AUTO_PREAMP })}
          className="ml-auto"
        >
          <RotateCcw aria-hidden />
          Reset curve
        </Button>
      </div>
      <Divider className="mt-3" />

      <Collapse open={areToolsOpen} className="shrink-0">
        <HeadphoneTools
          headphones={headphones}
          eq={eq}
          sampleRate={sampleRate}
          compare={compare}
          className="mt-2 flex flex-col gap-1"
        />
      </Collapse>

      <div className="flex min-h-40 flex-1">
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
                isRangeShown={headphones.isRangeShown}
                zeroWords={lines.isDifference && target !== null ? `0 is ${target.name}` : null}
              />
            )
          }
          instruments={
            layers.instruments ? (
              // It stops above the sound words, which sit along the bottom of the plot.
              <InstrumentChart
                highlighted={highlighted}
                onHighlight={setHighlighted}
                className={layers.words ? 'h-[88%] w-full' : 'w-full'}
              />
            ) : null
          }
          isOn={eq.enabled}
          hint={isFlat(bands) && !layers.instruments ? NOTHING_YET : null}
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
          className={cn(
            'mt-7 mb-10 ml-7 min-w-0 flex-1 transition-[margin] duration-(--dur-mid) ease-standard',
            // The ear's level scale needs room on the right.
            layers.ear ? 'mr-7' : 'mr-1',
          )}
        />

        <Tooltip label="Add band" side="left">
          <Button
            variant="ghost"
            size="bare"
            aria-label="Add band"
            disabled={bands.length >= EQ_MAX_BANDS}
            onClick={() => addBand(newBand(bands))}
            className="mt-7 mb-10 w-6 shrink-0 self-stretch"
          >
            <Plus aria-hidden />
          </Button>
        </Tooltip>
      </div>

      <Divider className="mb-3" />
      {selected === null ? null : (
        <BandEditor
          band={selected}
          sampleRate={sampleRate}
          number={selectedNumber}
          canRemove={bands.length > 1}
          onChange={changeBand}
          onRemove={() => removeBand(selected.id)}
          preamp={<PreampControl eq={eq} onChange={(preamp) => edit({ ...eq, preamp })} />}
          end={<PresetSaveButtons eq={eq} />}
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
      titleAside={<PresetBar eq={shown} />}
      closeLabel="Close equalizer"
      size="tall"
      onOpenAutoFocus={focusFirstNode}
    >
      <EqualizerContents eq={shown} edit={edit} endGroup={endGroup} compare={compare} />
    </Modal>
  );
}
