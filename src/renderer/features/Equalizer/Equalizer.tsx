import { Plus, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { EQ_MAX_BANDS, type EqBand, type EqSettings } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Switch } from '@/components/ui/Switch';
import { BandEditor } from '@/features/Equalizer/components/BandEditor';
import { PresetBar } from '@/features/Equalizer/components/PresetBar';
import { ResponseCurve } from '@/features/Equalizer/components/ResponseCurve';
import { useEqDraft } from '@/features/Equalizer/hooks/useEqDraft';
import { DEFAULT_BANDS, isFlat, newBand } from '@/features/Equalizer/utils/eqBands';
import { setEqualizerOpen, useEqualizerDialog } from '@/lib/equalizerDialog';

const NOTHING_YET = 'Drag a point to shape the sound';
const IS_OFF = 'Off, so the sound is untouched';

function hintFor(isOn: boolean, flat: boolean): string | null {
  if (flat) return NOTHING_YET;
  return isOn ? null : IS_OFF;
}

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
  change: (next: EqSettings) => void;
};

function EqualizerContents({ eq, change }: ContentsProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // No bands saved means it has never been touched. These only become real with the first change, which also turns it on.
  const isUntouched = eq.bands.length === 0;
  const bands = isUntouched ? DEFAULT_BANDS : eq.bands;
  const selected = bands.find(({ id }) => id === selectedId) ?? bands[0] ?? null;
  const selectedNumber = selected === null ? 0 : bands.indexOf(selected) + 1;

  function setBands(next: readonly EqBand[]): void {
    change({ enabled: isUntouched || eq.enabled, bands: [...next] });
  }

  function changeBand(band: EqBand): void {
    setBands(bands.map((other) => (other.id === band.id ? band : other)));
  }

  function addBand(): void {
    const band = newBand(bands);
    setSelectedId(band.id);
    setBands([...bands, band]);
  }

  function removeBand(id: number): void {
    setBands(bands.filter((band) => band.id !== id));
  }

  return (
    <div data-testid="equalizer" className="flex min-h-0 flex-1 flex-col overflow-y-auto p-section">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-gap gap-y-2">
        <PresetBar bands={eq.bands} />
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={bands.length >= EQ_MAX_BANDS} onClick={addBand}>
            <Plus aria-hidden />
            Add band
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isUntouched}
            onClick={() => change({ enabled: eq.enabled, bands: [] })}
          >
            <RotateCcw aria-hidden />
            Reset
          </Button>
        </div>
      </div>

      {/* The margins hold half a node at either end of the scale, and the frequency marks. */}
      <ResponseCurve
        bands={bands}
        isOn={eq.enabled}
        hint={hintFor(eq.enabled, isFlat(bands))}
        selectedId={selected?.id ?? null}
        onSelect={setSelectedId}
        onChange={changeBand}
        className="mt-7 mb-8 min-h-40 flex-1"
      />

      {selected === null ? null : (
        <BandEditor
          band={selected}
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
  const { eq, change } = useEqDraft();

  return (
    <Modal
      open={isOpen}
      onOpenChange={setEqualizerOpen}
      title="Equalizer"
      titleAside={
        <Switch
          checked={eq.enabled}
          onCheckedChange={(enabled) => change({ enabled, bands: eq.bands })}
          className="-my-2"
        >
          <span className="sr-only">Equalizer on</span>
        </Switch>
      }
      closeLabel="Close equalizer"
      size="tall"
      onOpenAutoFocus={focusFirstNode}
    >
      {isOpen ? <EqualizerContents eq={eq} change={change} /> : null}
    </Modal>
  );
}
