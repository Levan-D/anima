import { err } from '@shared/result';
import type { HandlerGroup } from '@main/ipc';

const notBuilt = () => err('unexpected', "This part isn't built yet");

export const playerNotBuilt = {
  'player.setEq': notBuilt,
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
