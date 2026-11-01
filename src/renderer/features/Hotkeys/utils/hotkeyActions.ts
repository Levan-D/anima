import type { HotkeyAction } from '@/features/Hotkeys/utils/keyMap';
import { toggleArtOverlay } from '@/lib/artOverlay';
import { toggleEqualizer } from '@/lib/equalizerDialog';
import { focusSearchField } from '@/lib/listDom';
import { currentPage, openSettings, showPage } from '@/lib/pages';
import {
  playNextTrack,
  playPreviousTrack,
  seekTo,
  setMuted,
  setOutputMode,
  setVolume,
  stopPlayback,
  togglePlaying,
} from '@/lib/playerActions';
import { currentPosition } from '@/lib/playerPosition';
import { playerState } from '@/lib/playerStore';
import { closeQueueSheet, toggleQueueSheet } from '@/lib/queueSheet';
import { resetInterfaceSize, stepInterfaceSize } from '@/lib/uiScale';
import { backInMini, setMiniPlayer, toggleFullscreen } from '@/lib/windowActions';

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

// What it acts on is only there on the Library page, which takes a frame to come in from another.
function onLibraryPage(action: () => void): () => void {
  return () => {
    if (currentPage() === 'library') {
      action();
      return;
    }
    showPage('library');
    requestAnimationFrame(action);
  };
}

type Actions = Partial<Record<HotkeyAction, () => void>>;

export const PLAYBACK_ACTIONS = {
  togglePlaying: () => {
    const { queueLength, status } = playerState();
    if ((queueLength > 0 || currentPage() === 'radio') && status !== 'unavailable') togglePlaying();
  },
  stop: ifPlayable(stopPlayback),
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
    search: () => {
      closeQueueSheet();
      onLibraryPage(focusSearchField)();
    },
    settings: () => openSettings(),
    fullscreen: toggleFullscreen,
    miniPlayer: () => setMiniPlayer(true),
    queue: () => {
      if (currentPage() !== 'settings') toggleQueueSheet();
    },
    exclusive: () => setOutputMode(playerState().outputMode === 'exclusive' ? 'shared' : 'exclusive'),
    lyrics: onLibraryPage(() => toggleArtOverlay('lyrics')),
    equalizer: toggleEqualizer,
    radio: () => showPage('radio'),
    sizeUp: () => stepInterfaceSize(1),
    sizeDown: () => stepInterfaceSize(-1),
    sizeReset: resetInterfaceSize,
    help: openHelp,
  };
}

export const MINI_WINDOW_ACTIONS: Actions = {
  ...PLAYBACK_ACTIONS,
  back: backInMini,
  miniPlayer: () => setMiniPlayer(false),
  queue: toggleQueueSheet,
};
