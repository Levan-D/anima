import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Ellipsis, Plus } from 'lucide-react';
import { useState } from 'react';
import type { EqImport, EqSettings } from '@shared/domain';
import type { Result } from '@shared/result';
import { NO_EQ, useEqPresetChoices } from '@/components/music/useEqPresetChoices';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import { Fade } from '@/components/ui/Fade';
import type { MenuEntry } from '@/components/ui/menuEntries';
import { NameDialog } from '@/components/ui/NameDialog';
import { Tooltip } from '@/components/ui/Tooltip';
import { isFlat, samePreamp, samePresetBands } from '@/features/Equalizer/utils/eqBands';
import { call } from '@/lib/api';
import { settingsQuery } from '@/lib/libraryQueries';
import { showToast, tellIfRefused } from '@/lib/toastStore';

function tellOfImport(result: Result<EqImport | null>): void {
  tellIfRefused(result);
  const clamped = result.ok ? (result.value?.clampedBands ?? 0) : 0;
  if (clamped === 0) return;
  const bands = clamped === 1 ? '1 band' : `${clamped} bands`;
  showToast({ message: `Gain brought down to 12 dB on ${bands}`, level: 'warning' });
}

const UNSAVED = 'Unsaved';

function item(label: string, onSelect: () => void): MenuEntry {
  return { kind: 'item', label, onSelect };
}

/** What's picked, and whether the plot still says what it says. */
function usePresetState({ enabled, bands, preamp }: EqSettings) {
  const { data: settings } = useQuery(settingsQuery);
  const presets = settings?.eqPresets ?? [];
  const current = enabled ? (presets.find(({ name }) => name === settings?.eqPreset) ?? null) : null;
  const isEdited = current !== null && !(samePresetBands(current.bands, bands) && samePreamp(current.preamp, preamp));
  const isUnsaved = enabled && current === null && !(isFlat(bands) && preamp.auto);
  return { current, isEdited, isUnsaved };
}

type NewProps = {
  isSaving: boolean;
  onClose: () => void;
};

function NewPresetDialog({ isSaving, onClose }: NewProps) {
  return (
    <NameDialog
      title={isSaving ? 'Save as a new preset' : 'Create a new preset'}
      submitLabel={isSaving ? 'Save' : 'Create'}
      fieldLabel="Preset name"
      onSubmit={(name) => call('eq.createPreset', { name })}
      onClose={onClose}
    />
  );
}

type Props = {
  /** What's on the plot now, to tell whether it's still what the preset says. */
  eq: EqSettings;
};

/** The top of the equalizer: what's picked, and creating from there. Off is one of the picks, not a switch. */
export function PresetBar({ eq }: Props) {
  const { current, isEdited, isUnsaved } = usePresetState(eq);
  const [isCreating, setIsCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const choices = useEqPresetChoices({ onRename: setRenaming, onDelete: setDeleting });

  const noPresetLabel = isUnsaved ? UNSAVED : NO_EQ;
  const editedName = isEdited && current !== null ? `${current.name} · edited` : current?.name;
  const label = editedName ?? noPresetLabel;

  const actions: MenuEntry[] = [
    item('Import', () => void call('eq.importPreset').then(tellOfImport)),
    ...(current === null
      ? []
      : [item('Export', () => void call('eq.exportPreset', { name: current.name }).then(tellIfRefused))]),
  ];

  // Its curve would otherwise stay on, as something unsaved nobody asked for.
  async function deletePreset(name: string): Promise<void> {
    const wasCurrent = name === current?.name;
    const deleted = await call('eq.deletePreset', { name });
    tellIfRefused(deleted);
    if (deleted.ok && wasCurrent) tellIfRefused(await call('eq.clearPreset'));
  }

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
        <Button variant="outline" size="md" onClick={() => setIsCreating(true)}>
          <Plus aria-hidden />
          Create new
        </Button>
      </Fade>

      {isCreating ? <NewPresetDialog isSaving={false} onClose={() => setIsCreating(false)} /> : null}
      {renaming === null ? null : (
        <NameDialog
          title="Rename preset"
          submitLabel="Rename"
          fieldLabel="Preset name"
          initialName={renaming}
          onSubmit={(newName) => call('eq.renamePreset', { name: renaming, newName })}
          onClose={() => setRenaming(null)}
        />
      )}
      {deleting === null ? null : (
        <ConfirmDialog
          title={`Delete ${deleting}?`}
          description="This preset is deleted for good, unless you exported it"
          confirmLabel="Delete"
          onConfirm={() => void deletePreset(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

/** At the bottom of the equalizer, once there's something to keep. */
export function PresetSaveButtons({ eq }: Props) {
  const { current, isEdited, isUnsaved } = usePresetState(eq);
  const [isNaming, setIsNaming] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <Fade show={isEdited} className="flex items-center gap-2">
        {isEdited && current !== null ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void call('eq.applyPreset', { name: current.name }).then(tellIfRefused)}
            >
              Revert
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void call('eq.savePreset', { name: current.name }).then(tellIfRefused)}
            >
              Save
            </Button>
          </>
        ) : null}
      </Fade>
      <Fade show={isUnsaved}>
        <Button variant="primary" size="sm" onClick={() => setIsNaming(true)}>
          Save as new
        </Button>
      </Fade>
      {isNaming ? <NewPresetDialog isSaving onClose={() => setIsNaming(false)} /> : null}
    </div>
  );
}
