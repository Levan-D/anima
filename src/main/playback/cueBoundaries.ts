/*
 * Tracks are time ranges of a file. A normal file is the whole of it, and a CUE album is several ranges of one.
 * Ranges that follow on from each other play as one stretch of the file, which mpv sees as one entry.
 */

import type { TrackRange } from '@main/library/queries';

/** Past this close to the end, mpv could run off it, and seeking past the end is an error. */
const SEEK_END_MARGIN_MS = 500;

export type RangedItem = {
  queueId: number;
  track: { id: number };
  range: TrackRange;
};

/** A stretch of one file: the items it plays through, and where it starts and stops. */
export type Run = {
  queueIds: number[];
  firstQueueId: number;
  trackId: number;
  fileId: number;
  startMs: number;
  endMs: number | null;
};

export function isContiguous(a: TrackRange, b: TrackRange): boolean {
  return a.fileId === b.fileId && a.endMs !== null && a.endMs === b.startMs;
}

export function isPartOfFile({ startMs, endMs }: TrackRange): boolean {
  return startMs > 0 || endMs !== null;
}

/** The items from `index` on that play as one stretch. Null when there's nothing at `index`. */
export function runFrom(items: readonly RangedItem[], index: number): Run | null {
  const first = items[index];
  if (first === undefined) return null;

  let last = first;
  const queueIds = [first.queueId];
  for (let at = index + 1; ; at++) {
    const item = items[at];
    if (item === undefined || !isContiguous(last.range, item.range)) break;
    queueIds.push(item.queueId);
    last = item;
  }
  return {
    queueIds,
    firstQueueId: first.queueId,
    trackId: first.track.id,
    fileId: first.range.fileId,
    startMs: first.range.startMs,
    endMs: last.range.endMs,
  };
}

/** The index of the item playing at `fileMs`, given the one that was. Moves forward only, within the stretch. */
export function indexAtPosition(items: readonly RangedItem[], index: number, fileMs: number): number {
  let at = index;
  for (;;) {
    const item = items[at];
    const next = items[at + 1];
    if (item === undefined || next === undefined || !isContiguous(item.range, next.range)) return at;
    if (item.range.endMs === null || fileMs < item.range.endMs) return at;
    at++;
  }
}

/** A position within a track, kept clear of its end. */
export function clampSeek(positionMs: number, durationMs: number): number {
  return Math.max(0, Math.min(positionMs, durationMs - SEEK_END_MARGIN_MS));
}
