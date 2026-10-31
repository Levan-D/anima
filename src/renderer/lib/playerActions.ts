/* Commands to the Player. Each one says so when main refuses, and whatever it changes comes back as a new state. */

import type { EnqueuePlace, OutputMode, ReplayGainMode, Track } from '@shared/domain';
import type { Result } from '@shared/result';
import { call } from '@/lib/api';
import { showSeek } from '@/lib/playerPosition';
import { showToast } from '@/lib/toastStore';

function tellIfRefused(result: Result<unknown>): void {
  if (!result.ok) showToast({ message: result.error.message, level: 'error' });
}

/** The queue becomes this list, from this row. Rows are the same objects as the list's, so this finds the very one. */
export function playTracks(tracks: readonly Track[], start: Track | undefined = tracks[0]): void {
  const startIndex = start === undefined ? -1 : tracks.indexOf(start);
  if (startIndex < 0) return;
  void call('player.play', { trackIds: tracks.map(({ id }) => id), startIndex }).then(tellIfRefused);
}

export function playQueueIndex(index: number): void {
  void call('player.playQueueIndex', { index }).then(tellIfRefused);
}

export function togglePlaying(): void {
  void call('player.toggle').then(tellIfRefused);
}

export function playNextTrack(): void {
  void call('player.next').then(tellIfRefused);
}

export function playPreviousTrack(): void {
  void call('player.previous').then(tellIfRefused);
}

export function retryPlayback(): void {
  void call('player.retry').then(tellIfRefused);
}

export function seekTo(positionMs: number): void {
  const target = Math.max(positionMs, 0);
  showSeek(target);
  void call('player.seek', { positionMs: target }).then(tellIfRefused);
}

export function setVolume(volume: number): Promise<void> {
  return call('player.setVolume', { volume }).then(tellIfRefused);
}

export function setMuted(muted: boolean): void {
  void call('player.setMuted', { muted }).then(tellIfRefused);
}

export function setOutputMode(mode: OutputMode): void {
  void call('player.setOutputMode', { mode }).then(tellIfRefused);
}

export function setReplayGainMode(mode: ReplayGainMode): void {
  void call('player.setReplayGainMode', { mode }).then(tellIfRefused);
}

const ENQUEUED_WORDS: Record<EnqueuePlace, string> = { next: 'Playing next', end: 'Added to the queue' };

export function enqueueTrack({ id, title }: Track, where: EnqueuePlace): void {
  void call('player.enqueue', { trackIds: [id], where }).then((result) => {
    tellIfRefused(result);
    if (result.ok) showToast({ message: `${ENQUEUED_WORDS[where]}: ${title}` });
  });
}

export function removeFromQueue(queueId: number): void {
  void call('player.removeFromQueue', { queueIds: [queueId] }).then(tellIfRefused);
}

export function moveInQueue(queueId: number, toIndex: number): void {
  void call('player.moveInQueue', { queueId, toIndex }).then(tellIfRefused);
}

export function clearQueue(): void {
  void call('player.clearQueue').then(tellIfRefused);
}
