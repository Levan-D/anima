import { Plus, RotateCcw, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { EQ_MAX_BANDS, type EqBand } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { Text } from '@/components/ui/Text';
import { BandEditor } from '@/features/Equalizer/components/BandEditor';
import { ResponseCurve } from '@/features/Equalizer/components/ResponseCurve';
import { useEqDraft } from '@/features/Equalizer/hooks/useEqDraft';
import { useFocusWhileOpen } from '@/features/Equalizer/hooks/useFocusWhileOpen';
import { DEFAULT_BANDS, newBand } from '@/features/Equalizer/utils/eqBands';
import { closeArtOverlay } from '@/lib/artOverlay';

const NOTHING_YET = 'Drag a point to shape the sound';
const IS_OFF = 'Off, so the sound is untouched';

function hintFor(isOn: boolean, isFlat: boolean): string | null {
  if (isFlat) return NOTHING_YET;
  return isOn ? null : IS_OFF;
}

/** Over the art like the lyrics, but a tap on the background doesn't close it: a finger that just misses a node would. */
export function Equalizer() {
  const { eq, change } = useEqDraft();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  useFocusWhileOpen(panel, '[role="slider"]');

  // No bands saved means it has never been touched. These only become real with the first change, which also turns it on.
  const isUntouched = eq.bands.length === 0;
  const bands = isUntouched ? DEFAULT_BANDS : eq.bands;
  const isFlat = bands.every(({ gainDb }) => gainDb === 0);
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
    <div
      ref={panel}
      data-testid="equalizer"
      // Below the title bar's strip, which would take any tap meant for what's under it.
      className="flex size-full animate-fade-rise flex-col gap-1 overflow-y-auto bg-scrim-strong pt-title-bar pb-1"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-x-1 px-gutter">
        <Switch checked={eq.enabled} onCheckedChange={(enabled) => change({ enabled, bands: eq.bands })}>
          <Text variant="body">Equalizer</Text>
        </Switch>
        <Button variant="ghost" size="sm" className="ml-auto" disabled={bands.length >= EQ_MAX_BANDS} onClick={addBand}>
          <Plus aria-hidden />
          Add band
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={isUntouched}
          onClick={() => change({ enabled: eq.enabled, bands: [] })}
        >
          <RotateCcw aria-hidden />
          Reset
        </Button>
        <Button variant="ghost" size="icon" aria-label="Close equalizer" onClick={() => closeArtOverlay()}>
          <X aria-hidden />
        </Button>
      </div>

      <ResponseCurve
        bands={bands}
        isOn={eq.enabled}
        hint={hintFor(eq.enabled, isFlat)}
        selectedId={selected?.id ?? null}
        onSelect={setSelectedId}
        onChange={changeBand}
        className="mx-section mt-4 mb-7 min-h-40 flex-1"
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
