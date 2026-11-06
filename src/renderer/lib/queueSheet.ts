/* Whether the queue's sheet is up. Here because the Queue button, the hotkey and going somewhere else all change it. */

import { create } from 'zustand';

const useQueueSheetStore = create<{ isOpen: boolean }>()(() => ({ isOpen: false }));

export function useQueueSheet(): boolean {
  return useQueueSheetStore((state) => state.isOpen);
}

export function setQueueSheetOpen(isOpen: boolean): void {
  useQueueSheetStore.setState({ isOpen });
}

export function closeQueueSheet(): void {
  setQueueSheetOpen(false);
}

export function toggleQueueSheet(): void {
  useQueueSheetStore.setState((state) => ({ isOpen: !state.isOpen }));
}

/** The transport's button, which the sheet rises out of. They're different features, so it's found by this attribute. */
export function queueButton(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-queue-button]');
}
