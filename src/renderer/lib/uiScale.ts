import { call, on } from '@/lib/api';

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
