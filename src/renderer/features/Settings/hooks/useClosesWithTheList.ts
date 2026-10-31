import { useEffect } from 'react';
import { closeSettings } from '@/lib/settingsDialog';

/** Whatever took the list away, such as the screen for a library that's gone, shouldn't find Settings open behind it. */
export function useClosesWithTheList(): void {
  useEffect(() => closeSettings, []);
}
