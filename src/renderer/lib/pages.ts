/*
 * Which page the window is showing. A page keeps its state where it always did (the Library's in lib/navigation and
 * lib/listMemory), so it can unmount while it's away and come back as it was.
 */
import { create } from 'zustand';

export const PAGES = ['library', 'radio', 'discover'] as const;
export type Page = (typeof PAGES)[number];

const usePageStore = create<{ page: Page }>()(() => ({ page: 'library' }));

export function usePage(): Page {
  return usePageStore((state) => state.page);
}

export function currentPage(): Page {
  return usePageStore.getState().page;
}

export function showPage(page: Page): void {
  usePageStore.setState({ page });
}
