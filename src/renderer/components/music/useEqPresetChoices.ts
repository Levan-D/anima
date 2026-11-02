import { useQuery } from '@tanstack/react-query';
import type { Result } from '@shared/result';
import type { MenuEntry } from '@/components/ui/menuEntries';
import { call } from '@/lib/api';
import { settingsQuery } from '@/lib/libraryQueries';
import { usePlayer } from '@/lib/playerStore';
import { showToast } from '@/lib/toastStore';

/** Choosing this is what turns the equalizer off: there's no switch for it. */
export const NO_EQ = 'Flat';

function tellIfRefused(result: Result<unknown>): void {
  if (!result.ok) showToast({ message: result.error.message, level: 'error' });
}

/** Picking one is how the equalizer gets set, from the transport's button and from the equalizer itself. */
export function useEqPresetChoices(): MenuEntry[] {
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
    })),
  ];
}
