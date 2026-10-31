import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { EqBand } from '@shared/domain';
import type { Result } from '@shared/result';
import { Button } from '@/components/ui/Button';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import type { MenuEntry } from '@/components/ui/menuEntries';
import { NameDialog } from '@/components/ui/NameDialog';
import { samePresetBands } from '@/features/Equalizer/utils/eqBands';
import { call } from '@/lib/api';
import { settingsQuery } from '@/lib/libraryQueries';
import { showToast } from '@/lib/toastStore';

function tellIfRefused(result: Result<unknown>): void {
  if (!result.ok) showToast({ message: result.error.message, level: 'error' });
}

type Props = {
  /** What's on the plot now, to tell whether it's still what the preset says. */
  bands: readonly EqBand[];
};

export function PresetBar({ bands }: Props) {
  const { data: settings } = useQuery(settingsQuery);
  const [naming, setNaming] = useState<'new' | 'rename' | null>(null);

  const presets = settings?.eqPresets ?? [];
  const current = presets.find(({ name }) => name === settings?.eqPreset) ?? null;
  const isChanged = current !== null && !samePresetBands(current.bands, bands);
  const label = current === null ? 'No preset' : current.name;

  const entries: MenuEntry[] =
    presets.length === 0
      ? [{ kind: 'label', label: 'No presets yet' }]
      : presets.map(({ name }) => ({
          kind: 'item',
          label: name,
          onSelect: () => void call('eq.applyPreset', { name }).then(tellIfRefused),
        }));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu entries={entries} align="start">
        <Button variant="outline" size="sm" data-testid="eq-preset" aria-label={`Preset: ${label}`}>
          {label}
          {isChanged ? ' · changed' : ''}
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenu>
      <Button
        variant="outline"
        size="sm"
        disabled={!isChanged}
        onClick={() => {
          if (current) void call('eq.savePreset', { name: current.name }).then(tellIfRefused);
        }}
      >
        Save
      </Button>
      <Button variant="outline" size="sm" onClick={() => setNaming('new')}>
        Save as new
      </Button>
      <Button variant="outline" size="sm" disabled={current === null} onClick={() => setNaming('rename')}>
        Rename
      </Button>
      <Button
        variant="danger"
        size="sm"
        disabled={current === null}
        onClick={() => {
          if (current) void call('eq.deletePreset', { name: current.name }).then(tellIfRefused);
        }}
      >
        Delete
      </Button>
      <Button variant="outline" size="sm" onClick={() => void call('eq.importPreset').then(tellIfRefused)}>
        Import
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={current === null}
        onClick={() => {
          if (current) void call('eq.exportPreset', { name: current.name }).then(tellIfRefused);
        }}
      >
        Export
      </Button>

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
