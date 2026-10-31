import { useSyncExternalStore } from 'react';
import { UI_SCALE_MAX, UI_SCALE_MIN } from '@shared/domain';
import { call, on } from '@/lib/api';
import { showToast } from '@/lib/toastStore';

const SMALLEST_WINDOW = { width: 640, height: 480 };
const KEY_STEP = 0.1;

let applied = 1;
// A held key outruns the round trip to main, and what comes back from an earlier step mustn't undo a later one.
let saving = 0;

function applyUiScale(scale: number): void {
  applied = scale;
  document.documentElement.style.setProperty('--ui-scale', String(scale));
}

function syncFromMain(): Promise<void> {
  return call('settings.get').then((result) => {
    if (result.ok) applyUiScale(result.value.uiScale);
  });
}

/** Resolves once the saved size is on the page. */
export function startUiScaleSync(): Promise<void> {
  on('settings.changed', ({ uiScale }) => {
    if (saving === 0) applyUiScale(uiScale);
  });
  return syncFromMain();
}

export function setInterfaceSize(uiScale: number): void {
  applyUiScale(uiScale);
  saving += 1;
  void call('settings.update', { uiScale }).then((result) => {
    saving -= 1;
    if (result.ok) return;
    showToast({ message: result.error.message, level: 'error' });
    void syncFromMain();
  });
}

export function isInterfaceSizeSaving(): boolean {
  return saving > 0;
}

function windowLimit(): number {
  return Math.min(window.innerHeight / SMALLEST_WINDOW.height, window.innerWidth / SMALLEST_WINDOW.width);
}

/** From what the window is really showing, or the first steps down from a size it can't hold would change nothing. */
export function stepInterfaceSize(direction: 1 | -1): void {
  const limit = Math.min(windowLimit(), UI_SCALE_MAX);
  const showing = Math.min(applied, limit);
  if (direction === 1 && showing >= limit) {
    showToast({ message: `This window only has room for ${Math.floor(limit * 100)}%` });
    return;
  }
  const stepped = Math.round((showing + direction * KEY_STEP) * 100) / 100;
  const next = Math.min(Math.max(stepped, UI_SCALE_MIN), UI_SCALE_MAX);
  if (next !== applied) setInterfaceSize(next);
}

export function resetInterfaceSize(): void {
  if (applied !== 1) setInterfaceSize(1);
}

function onWindowResize(listener: () => void): () => void {
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
}

/** The most this window can take, which is the same sum --scale does in globals.css. Only for saying so. */
export function useWindowScaleLimit(): number {
  return Math.min(useSyncExternalStore(onWindowResize, windowLimit), UI_SCALE_MAX);
}
