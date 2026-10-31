import type { HotkeyAction } from '@/features/Hotkeys/utils/keyMap';
import { toggleArtOverlay } from '@/lib/artOverlay';
import { toggleEqualizer } from '@/lib/equalizerDialog';
import { focusSearchField } from '@/lib/listDom';
import { selectTab } from '@/lib/navigation';
import { openSettings } from '@/lib/settingsDialog';
import {
  playNextTrack,
  playPreviousTrack,
  seekTo,
  setMuted,
  setOutputMode,
  setRadio,
  setVolume,
  togglePlaying,
} from '@/lib/playerActions';
import { currentPosition } from '@/lib/playerPosition';
import { playerState } from '@/lib/playerStore';
import { showToast } from '@/lib/toastStore';
import { resetInterfaceSize, stepInterfaceSize } from '@/lib/uiScale';
import { setMiniPlayer, toggleFullscreen } from '@/lib/windowActions';

const SEEK_MS = 5_000;
const SEEK_FAR_MS = 30_000;
const VOLUME_STEP = 5;

// These do what the transport's buttons do, including nothing at the times those are disabled.
function whenPlayable(state: ReturnType<typeof playerState>): boolean {
  return state.current !== null && state.status !== 'unavailable';
}

function seekBy(deltaMs: number): void {
  const state = playerState();
  if (whenPlayable(state)) seekTo(Math.min(currentPosition() + deltaMs, state.durationMs));
}

function stepVolume(delta: number): void {
  const { volume, muted } = playerState();
  void setVolume(Math.min(Math.max(volume + delta, 0), 100));
  // Reaching for the volume means wanting to hear it.
  if (muted) setMuted(false);
}

function ifPlayable(action: () => void): () => void {
  return () => {
    if (whenPlayable(playerState())) action();
  };
}

// The switch shows it, but the switch can be folded away, and a key says nothing by itself.
function toggleRadio(): void {
  const on = !playerState().radio;
  setRadio(on);
  showToast({ message: on ? 'Radio on' : 'Radio off' });
}

type Actions = Partial<Record<HotkeyAction, () => void>>;

export const PLAYBACK_ACTIONS = {
  togglePlaying: () => {
    const { queueLength, status } = playerState();
    if (queueLength > 0 && status !== 'unavailable') togglePlaying();
  },
  seekBack: () => seekBy(-SEEK_MS),
  seekForward: () => seekBy(SEEK_MS),
  seekBackFar: () => seekBy(-SEEK_FAR_MS),
  seekForwardFar: () => seekBy(SEEK_FAR_MS),
  previous: ifPlayable(playPreviousTrack),
  next: ifPlayable(playNextTrack),
  volumeUp: () => stepVolume(VOLUME_STEP),
  volumeDown: () => stepVolume(-VOLUME_STEP),
  toggleMute: () => setMuted(!playerState().muted),
} satisfies Actions;

/** Escape isn't here: useBackKeys has it, along with the other keys that go back. */
export function mainWindowActions(openHelp: () => void): Actions {
  return {
    ...PLAYBACK_ACTIONS,
    search: focusSearchField,
    settings: () => openSettings(),
    fullscreen: toggleFullscreen,
    miniPlayer: () => setMiniPlayer(true),
    queue: () => selectTab('queue'),
    exclusive: () => setOutputMode(playerState().outputMode === 'exclusive' ? 'shared' : 'exclusive'),
    lyrics: () => toggleArtOverlay('lyrics'),
    equalizer: toggleEqualizer,
    radio: toggleRadio,
    sizeUp: () => stepInterfaceSize(1),
    sizeDown: () => stepInterfaceSize(-1),
    sizeReset: resetInterfaceSize,
    help: openHelp,
  };
}

export const MINI_WINDOW_ACTIONS: Actions = {
  ...PLAYBACK_ACTIONS,
  back: () => setMiniPlayer(false),
  miniPlayer: () => setMiniPlayer(false),
};
