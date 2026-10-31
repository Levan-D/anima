/* Whether Settings is up, and on which tab. Here because hotkeys, notices and the gear all open it. */

import { create } from 'zustand';

export const SETTINGS_TABS = ['playback', 'interface', 'library', 'lyrics', 'data', 'storage', 'stats'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

type SettingsDialogState = {
  isOpen: boolean;
  tab: SettingsTab;
};

const useSettingsDialogStore = create<SettingsDialogState>()(() => ({ isOpen: false, tab: 'playback' }));

export function useSettingsDialog<T>(selector: (state: SettingsDialogState) => T): T {
  return useSettingsDialogStore(selector);
}

/** On the tab it was last on, unless the caller has somewhere to send it. */
export function openSettings(tab?: SettingsTab): void {
  useSettingsDialogStore.setState((state) => ({ isOpen: true, tab: tab ?? state.tab }));
}

export function closeSettings(): void {
  useSettingsDialogStore.setState({ isOpen: false });
}

export function chooseSettingsTab(tab: SettingsTab): void {
  useSettingsDialogStore.setState({ tab });
}
