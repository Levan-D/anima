import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Ellipsis } from 'lucide-react';
import { useState } from 'react';
import type { EqImport, EqSettings } from '@shared/domain';
import type { Result } from '@shared/result';
import { Button } from '@/components/ui/Button';
import { Fade } from '@/components/ui/Fade';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import type { MenuEntry } from '@/components/ui/menuEntries';
import { NameDialog } from '@/components/ui/NameDialog';
import { Tooltip } from '@/components/ui/Tooltip';
import { isFlat, samePreamp, samePresetBands } from '@/features/Equalizer/utils/eqBands';
import { call } from '@/lib/api';
import { settingsQuery } from '@/lib/libraryQueries';
import { showToast } from '@/lib/toastStore';

function tellIfRefused(result: Result<unknown>): void {
  if (!result.ok) showToast({ message: result.error.message, level: 'error' });
}

function tellOfImport(result: Result<EqImport | null>): void {
  tellIfRefused(result);
  const clamped = result.ok ? (result.value?.clampedBands ?? 0) : 0;
  if (clamped === 0) return;
  const bands = clamped === 1 ? '1 band' : `${clamped} bands`;
  showToast({ message: `Gain brought down to 12 dB on ${bands}`, level: 'warning' });
}

const NO_EQ = 'No EQ';
const UNSAVED = 'Unsaved';

function item(label: string, onSelect: () => void, destructive = false): MenuEntry {
  return { kind: 'item', label, onSelect, destructive };
}

type Props = {
  /** What's on the plot now, to tell whether it's still what the preset says. */
  eq: EqSettings;
};

export function PresetBar({ eq: { bands, preamp } }: Props) {
  const { data: settings } = useQuery(settingsQuery);
  const [naming, setNaming] = useState<'new' | 'rename' | null>(null);

  const presets = settings?.eqPresets ?? [];
  const current = presets.find(({ name }) => name === settings?.eqPreset) ?? null;
  const isEdited = current !== null && !(samePresetBands(current.bands, bands) && samePreamp(current.preamp, preamp));
  const isUnsaved = current === null && !(isFlat(bands) && preamp.auto);

  const noPresetLabel = isUnsaved ? UNSAVED : NO_EQ;
  const editedName = isEdited ? `${current.name} · edited` : current?.name;
  const label = editedName ?? noPresetLabel;

  const choices: MenuEntry[] = [
    item(NO_EQ, () => void call('eq.clearPreset').then(tellIfRefused)),
    ...presets.map(({ name }) => item(name, () => void call('eq.applyPreset', { name }).then(tellIfRefused))),
  ];

  const actions: MenuEntry[] = [
    ...(current !== null || isUnsaved ? [item('Save as new', () => setNaming('new'))] : []),
    ...(current === null
      ? []
      : [
          item('Rename', () => setNaming('rename')),
          item('Delete', () => void call('eq.deletePreset', { name: current.name }).then(tellIfRefused), true),
        ]),
    item('Import', () => void call('eq.importPreset').then(tellOfImport)),
    ...(current === null
      ? []
      : [item('Export', () => void call('eq.exportPreset', { name: current.name }).then(tellIfRefused))]),
  ];

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <DropdownMenu entries={choices} align="start">
        <Button
          variant="outline"
          size="md"
          data-testid="eq-preset"
          aria-label={`Preset: ${label}`}
          className="max-w-90 min-w-44 [&>span]:w-full [&>span]:justify-between"
        >
          <span className="min-w-0 truncate">{label}</span>
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenu>
      <DropdownMenu entries={actions} align="start">
        <Tooltip label="Preset actions">
          <Button variant="outline" size="icon-md" aria-label="Preset actions">
            <Ellipsis aria-hidden />
          </Button>
        </Tooltip>
      </DropdownMenu>

      <Fade show={isEdited} className="flex items-center gap-2">
        {isEdited ? (
          <>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void call('eq.savePreset', { name: current.name }).then(tellIfRefused)}
            >
              Save
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void call('eq.applyPreset', { name: current.name }).then(tellIfRefused)}
            >
              Revert
            </Button>
          </>
        ) : null}
      </Fade>
      <Fade show={isUnsaved}>
        <Button variant="primary" size="sm" onClick={() => setNaming('new')}>
          Save as new
        </Button>
      </Fade>

      {naming === 'new' ? (
        <NameDialog
          title="Save as a new preset"
          submitLabel="Save"
          fieldLabel="Preset name"
          onSubmit={(name) => call('eq.createPreset', { name })}
          onClose={() => setNaming(null)}
        />
      ) : null}
      {naming === 'rename' && current ? (
        <NameDialog
          title="Rename preset"
          submitLabel="Rename"
          fieldLabel="Preset name"
          initialName={current.name}
          onSubmit={(newName) => call('eq.renamePreset', { name: current.name, newName })}
          onClose={() => setNaming(null)}
        />
      ) : null}
    </div>
  );
}
