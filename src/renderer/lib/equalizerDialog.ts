/* Whether the equalizer is up. Here because the hotkey and the transport's button both open it. */

import { create } from 'zustand';

const useEqualizerDialogStore = create<{ isOpen: boolean }>()(() => ({ isOpen: false }));

export function useEqualizerDialog(): boolean {
  return useEqualizerDialogStore((state) => state.isOpen);
}

export function setEqualizerOpen(isOpen: boolean): void {
  useEqualizerDialogStore.setState({ isOpen });
}

export function toggleEqualizer(): void {
  useEqualizerDialogStore.setState((state) => ({ isOpen: !state.isOpen }));
}
