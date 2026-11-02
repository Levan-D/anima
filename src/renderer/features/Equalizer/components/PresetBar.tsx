import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Ellipsis, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { EqImport, EqSettings } from '@shared/domain';
import type { Result } from '@shared/result';
import { NO_EQ, useEqPresetChoices } from '@/components/music/useEqPresetChoices';
import { Button } from '@/components/ui/Button';
import { ConfirmIconButton } from '@/components/ui/ConfirmIconButton';
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

const UNSAVED = 'Unsaved';

/** Otherwise its curve would stay on, as something unsaved nobody asked for. */
async function deleteAndGoFlat(name: string): Promise<void> {
  const deleted = await call('eq.deletePreset', { name });
  tellIfRefused(deleted);
  if (deleted.ok) tellIfRefused(await call('eq.clearPreset'));
}

function item(label: string, onSelect: () => void, destructive = false): MenuEntry {
  return { kind: 'item', label, onSelect, destructive };
}

type Props = {
  /** What's on the plot now, to tell whether it's still what the preset says. */
  eq: EqSettings;
  onReset: () => void;
};

/** The top of the equalizer: what's picked, and creating or editing from there. Off is one of the picks, not a switch. */
export function PresetBar({ eq: { enabled, bands, preamp }, onReset }: Props) {
  const { data: settings } = useQuery(settingsQuery);
  const [naming, setNaming] = useState<'new' | 'rename' | null>(null);

  const presets = settings?.eqPresets ?? [];
  const current = enabled ? (presets.find(({ name }) => name === settings?.eqPreset) ?? null) : null;
  const isEdited = current !== null && !(samePresetBands(current.bands, bands) && samePreamp(current.preamp, preamp));
  const isUnsaved = enabled && current === null && !(isFlat(bands) && preamp.auto);

  const noPresetLabel = isUnsaved ? UNSAVED : NO_EQ;
  const editedName = isEdited ? `${current.name} · edited` : current?.name;
  const label = editedName ?? noPresetLabel;

  const choices = useEqPresetChoices();

  const actions: MenuEntry[] = [
    item('Import', () => void call('eq.importPreset').then(tellOfImport)),
    ...(current === null
      ? []
      : [
          item('Export', () => void call('eq.exportPreset', { name: current.name }).then(tellIfRefused)),
          item('Rename', () => setNaming('rename')),
        ]),
    item('Reset curve', onReset),
  ];

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
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

      <Fade show={current !== null}>
        <Button variant="outline" size="md" onClick={() => setNaming('new')}>
          <Plus aria-hidden />
          Create new
        </Button>
      </Fade>
      <Fade show={isEdited} className="flex items-center gap-2">
        {isEdited ? (
          <>
            <Button
              variant="primary"
              size="md"
              onClick={() => void call('eq.savePreset', { name: current.name }).then(tellIfRefused)}
            >
              Save
            </Button>
            <Button
              variant="outline"
              size="md"
              onClick={() => void call('eq.applyPreset', { name: current.name }).then(tellIfRefused)}
            >
              Revert
            </Button>
          </>
        ) : null}
      </Fade>
      <Fade show={isUnsaved}>
        <Button variant="primary" size="md" onClick={() => setNaming('new')}>
          Save as new
        </Button>
      </Fade>
      <Fade show={isUnsaved}>
        <ConfirmIconButton
          label="Discard this curve"
          icon={Trash2}
          onConfirm={() => void call('eq.clearPreset').then(tellIfRefused)}
        />
      </Fade>
      <Fade show={current !== null}>
        <ConfirmIconButton
          label="Delete this preset"
          icon={Trash2}
          onConfirm={() => {
            if (current !== null) void deleteAndGoFlat(current.name);
          }}
        />
      </Fade>

      {naming === 'new' ? (
        <NameDialog
          title={isUnsaved ? 'Save as a new preset' : 'Create a new preset'}
          submitLabel={isUnsaved ? 'Save' : 'Create'}
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
