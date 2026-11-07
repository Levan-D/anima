/*
 * What main says about playback, as it says it. Commands go out through lib/playerActions and come back as a new state
 * here, so nothing in React ever decides what plays next. Position has its own module, because it never re-renders.
 */
import { create } from 'zustand';
import { EQ_AUTO_PREAMP, type PlayerState } from '@shared/domain';
import { call, on } from '@/lib/api';

export const IDLE_PLAYER: PlayerState = {
  loadId: 0,
  status: 'idle',
  current: null,
  queueIndex: null,
  queueLength: 0,
  queueVersion: 0,
  durationMs: 0,
  volume: 100,
  muted: false,
  outputMode: 'shared',
  replayGainMode: 'album',
  eq: { enabled: false, bands: [], preamp: EQ_AUTO_PREAMP },
  endless: false,
  radio: { isSource: false, isStarting: false, problem: null, past: [], upNext: [] },
  from: null,
  signal: { decoded: null, output: null, isBitPerfect: false, kind: null, alterations: [] },
  error: null,
};

const usePlayerStore = create<PlayerState>()(() => IDLE_PLAYER);

/** Select primitives: a state from main is a new object every time, and so is everything in it. */
export function usePlayer<T>(selector: (state: PlayerState) => T): T {
  return usePlayerStore(selector);
}

export function playerState(): PlayerState {
  return usePlayerStore.getState();
}

export function onPlayerChange(listener: (state: PlayerState) => void): () => void {
  return usePlayerStore.subscribe(listener);
}

export function setPlayerState(state: PlayerState): void {
  usePlayerStore.setState(state, true);
}

/** Resolves once the state is on the page, so a window opening mid-song doesn't first paint as if nothing is playing. */
export function startPlayerSync(): Promise<void> {
  let hasHeard = false;
  on('player.state', (state) => {
    hasHeard = true;
    setPlayerState(state);
  });
  return call('player.state').then((result) => {
    // An event that got here first is newer than this reply.
    if (result.ok && !hasHeard) setPlayerState(result.value);
  });
}
