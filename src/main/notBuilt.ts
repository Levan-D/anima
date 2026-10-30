import { err } from '@shared/result';
import type { HandlerGroup } from '@main/ipc';

const notBuilt = () => err('unexpected', "This part isn't built yet");

export const playerNotBuilt = {
  'player.queue': notBuilt,
  'player.play': notBuilt,
  'player.playQueueIndex': notBuilt,
  'player.toggle': notBuilt,
  'player.pause': notBuilt,
  'player.resume': notBuilt,
  'player.next': notBuilt,
  'player.previous': notBuilt,
  'player.seek': notBuilt,
  'player.setVolume': notBuilt,
  'player.setMuted': notBuilt,
  'player.setOutputMode': notBuilt,
  'player.setReplayGainMode': notBuilt,
  'player.setEq': notBuilt,
  'player.enqueue': notBuilt,
  'player.removeFromQueue': notBuilt,
  'player.moveInQueue': notBuilt,
  'player.clearQueue': notBuilt,
  'player.retry': notBuilt,
} satisfies HandlerGroup;

export const playlistNotBuilt = {
  'playlist.list': notBuilt,
  'playlist.get': notBuilt,
  'playlist.create': notBuilt,
  'playlist.rename': notBuilt,
  'playlist.delete': notBuilt,
  'playlist.addTracks': notBuilt,
  'playlist.removeItems': notBuilt,
  'playlist.moveItems': notBuilt,
  'playlist.removeMissing': notBuilt,
} satisfies HandlerGroup;

export const lyricsNotBuilt = {
  'lyrics.get': notBuilt,
  'lyrics.refresh': notBuilt,
} satisfies HandlerGroup;

export const waveformNotBuilt = {
  'waveform.get': notBuilt,
} satisfies HandlerGroup;

export const statsNotBuilt = {
  'stats.summary': notBuilt,
} satisfies HandlerGroup;

export const miniPlayerNotBuilt = {
  'window.setMiniPlayer': notBuilt,
} satisfies HandlerGroup;
