import { useQuery } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import type { MenuEntry } from '@/components/ui/menuEntries';
import { call } from '@/lib/api';
import { settingsQuery } from '@/lib/libraryQueries';
import { usePlayer } from '@/lib/playerStore';
import { tellIfRefused } from '@/lib/toastStore';

/** Choosing this is what turns the equalizer off: there's no switch for it. */
export const NO_EQ = 'Flat';

/**
 * Picking one is how the equalizer gets set, from the transport's button and from the equalizer itself. Where there's
 * `manage`, each preset has rename and delete buttons on its row.
 */
export function useEqPresetChoices(manage?: {
  onRename: (name: string) => void;
  onDelete: (name: string) => void;
}): MenuEntry[] {
  const { data: settings } = useQuery(settingsQuery);
  const isOn = usePlayer((state) => state.eq.enabled);

  return [
    {
      kind: 'item',
      label: NO_EQ,
      isCurrent: !isOn,
      onSelect: () => void call('eq.clearPreset').then(tellIfRefused),
    },
    ...(settings?.eqPresets ?? []).map(({ name }): MenuEntry => ({
      kind: 'item',
      label: name,
      isCurrent: isOn && name === settings?.eqPreset,
      onSelect: () => void call('eq.applyPreset', { name }).then(tellIfRefused),
      ...(manage === undefined
        ? {}
        : {
            actions: [
              { label: `Rename ${name}`, icon: Pencil, onSelect: () => manage.onRename(name) },
              { label: `Delete ${name}`, icon: Trash2, isDanger: true, onSelect: () => manage.onDelete(name) },
            ],
          }),
    })),
  ];
}
