import { artUrl, type PlayerState, type Track } from '@shared/domain';
import { createSilentAudio, type SilentAudioGoal } from '@/features/MediaSession/utils/silentAudio';
import { on } from '@/lib/api';
import {
  pausePlayback,
  playNextTrack,
  playPreviousTrack,
  resumePlayback,
  seekTo,
  stopPlayback,
} from '@/lib/playerActions';
import { currentPosition } from '@/lib/playerPosition';
import { onPlayerChange, playerState } from '@/lib/playerStore';

/** How far the overlay's own count can wander before it's told again. Seeks go past this, and ticking doesn't. */
const DRIFT_MS = 1_500;
const THUMBNAIL_SIZE = '512x512';

function goalOf({ status, current }: PlayerState): SilentAudioGoal {
  if (current === null || status === 'unavailable') return 'nothing';
  return status === 'playing' || status === 'loading' ? 'playing' : 'paused';
}

const SESSION_STATES: Record<SilentAudioGoal, MediaSessionPlaybackState> = {
  nothing: 'none',
  paused: 'paused',
  playing: 'playing',
};

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string); // readAsDataURL only gives a string.
    reader.onerror = () => reject(new Error('Could not read the art'));
    reader.readAsDataURL(blob);
  });
}

/** Media Session refuses art:// outright, so it gets the bytes. Null when there are none: the overlay does without. */
async function artworkFor(hash: string): Promise<MediaImage[] | null> {
  try {
    const response = await fetch(artUrl(hash, 'thumb'));
    if (!response.ok) return null;
    const blob = await response.blob();
    return [{ src: await readAsDataUrl(blob), sizes: THUMBNAIL_SIZE, type: blob.type || 'image/jpeg' }];
  } catch {
    return null;
  }
}

function metadataOf({ title, artist, album }: Track, artwork: MediaImage[]): MediaMetadata {
  return new MediaMetadata({ title, artist: artist ?? '', album: album ?? '', artwork });
}

/** The Windows overlay and media keys, for as long as the returned function isn't called. */
export function startMediaSession(): () => void {
  const session = navigator.mediaSession;
  const audio = createSilentAudio();

  let metadataKey: string | null = null;
  let told: { positionMs: number; at: number; isRunning: boolean } | null = null;
  let toldKey: string | null = null;

  function tellPosition({ status, durationMs }: PlayerState): void {
    if (durationMs <= 0) {
      session.setPositionState();
      told = null;
      return;
    }
    const positionMs = Math.min(currentPosition(), durationMs);
    session.setPositionState({ duration: durationMs / 1000, position: positionMs / 1000, playbackRate: 1 });
    told = { positionMs, at: performance.now(), isRunning: status === 'playing' };
  }

  function followMetadata({ current }: PlayerState): void {
    const key = current === null ? null : `${current.id}:${current.artHash}`;
    if (key === metadataKey) return;
    metadataKey = key;

    if (current === null) {
      session.metadata = null;
      return;
    }
    session.metadata = metadataOf(current, []);
    if (current.artHash === null) return;
    void artworkFor(current.artHash).then((artwork) => {
      if (artwork !== null && metadataKey === key) session.metadata = metadataOf(current, artwork);
    });
  }

  function follow(state: PlayerState): void {
    const goal = goalOf(state);
    audio.follow(goal);
    session.playbackState = SESSION_STATES[goal];
    followMetadata(state);

    const key = `${state.loadId}:${state.status}:${state.durationMs}`;
    if (key !== toldKey) {
      toldKey = key;
      tellPosition(state);
    }
  }

  function checkDrift(): void {
    if (told === null) return;
    const expected = told.positionMs + (told.isRunning ? performance.now() - told.at : 0);
    if (Math.abs(currentPosition() - expected) > DRIFT_MS) tellPosition(playerState());
  }

  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ['play', resumePlayback],
    ['pause', pausePlayback],
    ['stop', stopPlayback],
    ['previoustrack', playPreviousTrack],
    ['nexttrack', playNextTrack],
    [
      'seekto',
      ({ seekTime }) => {
        if (seekTime != null) seekTo(seekTime * 1000);
      },
    ],
  ];
  for (const [action, handler] of handlers) session.setActionHandler(action, handler);

  const stopFollowing = onPlayerChange(follow);
  const stopHearing = on('player.position', checkDrift);
  follow(playerState());

  return () => {
    stopFollowing();
    stopHearing();
    for (const [action] of handlers) session.setActionHandler(action, null);
    session.metadata = null;
    session.playbackState = 'none';
    audio.stop();
  };
}
