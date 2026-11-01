import type { PowerMonitor, PowerSaveBlocker } from 'electron';
import type { PlayerState, StayAwake, StayAwakeMode } from '@shared/domain';
import type { SettingsStore } from '@main/settings/settings';

export type Blocker = 'prevent-app-suspension' | 'prevent-display-sleep';

const BLOCKERS: Record<StayAwakeMode, Blocker | null> = {
  off: null,
  'keep-running': 'prevent-app-suspension',
  'screen-on': 'prevent-display-sleep',
};

const BATTERY_RECHECK_MS = 60_000;

export function blockerFor(stayAwake: StayAwake, isOnBattery: boolean, isPlaying: boolean): Blocker | null {
  if (!isPlaying) return null;
  return BLOCKERS[isOnBattery ? stayAwake.onBattery : stayAwake.pluggedIn];
}

type Options = {
  settings: SettingsStore;
  blocker: PowerSaveBlocker;
  monitor: PowerMonitor;
};

/** Holds at most one power save blocker, the one the settings ask for right now. */
export function createPowerKeeper({ settings, blocker, monitor }: Options) {
  let isPlaying = false;
  let held: { id: number; type: Blocker } | null = null;
  let recheck: ReturnType<typeof setInterval> | null = null;

  function sync(): void {
    const wanted = blockerFor(settings.get().stayAwake, monitor.isOnBatteryPower(), isPlaying);
    if (wanted === (held === null ? null : held.type)) return;
    if (held !== null) blocker.stop(held.id);
    held = wanted === null ? null : { id: blocker.start(wanted), type: wanted };
  }

  function stopRechecking(): void {
    if (recheck !== null) clearInterval(recheck);
    recheck = null;
  }

  monitor.on('on-ac', sync);
  monitor.on('on-battery', sync);
  settings.onChange(sync);

  return {
    onPlayerState: ({ status }: PlayerState): void => {
      const next = status === 'playing' || status === 'loading';
      if (next === isPlaying) return;
      isPlaying = next;
      stopRechecking();
      // Electron 45 documents on-battery for macOS only, and missing an unplug would hold the screen on until the battery dies.
      if (isPlaying) recheck = setInterval(sync, BATTERY_RECHECK_MS);
      sync();
    },
    stop: (): void => {
      isPlaying = false;
      stopRechecking();
      sync();
    },
  };
}
