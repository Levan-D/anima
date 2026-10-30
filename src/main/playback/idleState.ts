import type { AppSettings, PlayerState } from '@shared/domain';
import { ok } from '@shared/result';
import type { HandlerGroup } from '@main/ipc';
import type { SettingsStore } from '@main/settings/settings';

export function idlePlayerState(settings: AppSettings): PlayerState {
  return {
    loadId: 0,
    status: 'idle',
    current: null,
    queueIndex: null,
    queueLength: 0,
    queueVersion: 0,
    durationMs: 0,
    volume: settings.volume,
    muted: settings.muted,
    outputMode: settings.outputMode,
    replayGainMode: settings.replayGainMode,
    eq: settings.eq,
    signal: { decoded: null, output: null, isBitPerfect: false, alterations: [] },
    error: null,
  };
}

export function playerHandlers(settings: SettingsStore) {
  return {
    'player.state': () => ok(idlePlayerState(settings.get())),
  } satisfies HandlerGroup;
}
