/*
 * Which page the window is showing. A page keeps its state where it always did (the Library's in lib/navigation and
 * lib/listMemory, Settings' tab here), so it can unmount while it's away and come back as it was.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { closeQueueSheet } from '@/lib/queueSheet';

export const PAGES = ['library', 'radio', 'discover', 'settings'] as const;
export type Page = (typeof PAGES)[number];

export const SETTINGS_TABS = ['playback', 'interface', 'library', 'lyrics', 'data', 'storage', 'stats'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

type PageState = {
  page: Page;
  /** Where leaving Settings goes. */
  cameFrom: Page;
  settingsTab: SettingsTab;
};

const usePageStore = create<PageState>()(() => ({ page: 'library', cameFrom: 'library', settingsTab: 'playback' }));

export function usePage(): Page {
  return usePageStore((state) => state.page);
}

export function currentPage(): Page {
  return usePageStore.getState().page;
}

export function showPage(page: Page): void {
  const before = currentPage();
  usePageStore.setState((state) => {
    if (state.page === page) return state;
    return { page, cameFrom: page === 'settings' ? state.page : state.cameFrom };
  });
  if (before !== page) closeQueueSheet();
}

export function useSettingsTab(): SettingsTab {
  return usePageStore((state) => state.settingsTab);
}

/** On the tab it was last on, unless the caller has somewhere to send it. */
export function openSettings(tab?: SettingsTab): void {
  if (tab !== undefined) chooseSettingsTab(tab);
  showPage('settings');
}

export function closeSettings(): void {
  const { page, cameFrom } = usePageStore.getState();
  if (page === 'settings') showPage(cameFrom);
}

export function chooseSettingsTab(settingsTab: SettingsTab): void {
  usePageStore.setState({ settingsTab });
}

/** Whatever took the pages away, such as the screen for a library that's gone, shouldn't come back to Settings. */
export function useClosesSettingsWithThePages(): void {
  useEffect(() => closeSettings, []);
}
