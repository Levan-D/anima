import { useSyncExternalStore } from 'react';
import { UI_SCALE_MAX } from '@shared/domain';
import { call, on } from '@/lib/api';
import { showToast } from '@/lib/toastStore';

const SMALLEST_WINDOW = { width: 640, height: 480 };

function applyUiScale(scale: number): void {
  document.documentElement.style.setProperty('--ui-scale', String(scale));
}

/** Resolves once the saved size is on the page. */
export function startUiScaleSync(): Promise<void> {
  on('settings.changed', ({ uiScale }) => applyUiScale(uiScale));
  return call('settings.get').then((result) => {
    if (result.ok) applyUiScale(result.value.uiScale);
  });
}

export function setInterfaceSize(uiScale: number): void {
  void call('settings.update', { uiScale }).then((result) => {
    if (!result.ok) showToast({ message: result.error.message, level: 'error' });
  });
}

function windowLimit(): number {
  return Math.min(window.innerHeight / SMALLEST_WINDOW.height, window.innerWidth / SMALLEST_WINDOW.width);
}

function onWindowResize(listener: () => void): () => void {
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
}

/** The most this window can take, which is the same sum --scale does in globals.css. Only for saying so. */
export function useWindowScaleLimit(): number {
  return Math.min(useSyncExternalStore(onWindowResize, windowLimit), UI_SCALE_MAX);
}
