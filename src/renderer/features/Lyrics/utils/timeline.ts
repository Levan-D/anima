/* What synced lyrics do over time. Pure: every time here is on the lyrics' own clock, before any nudge. */

import type { LyricLine } from '@shared/domain';

export type LyricRow = {
  startMs: number;
  /** When the highlight goes: the next stamp, or sooner if the line has run too long for its words. */
  stopMs: number;
  text: string;
};

/** Lines closer than this are read as one, rather than flickering past. */
const MERGE_WITHIN_MS = 500;
/** 932 of the library's syncs leave a line current for 20 s or more, through a solo or to the end of the song. */
const HOLD_BASE_MS = 5_000;
const HOLD_PER_WORD_MS = 700;
const WORD = /[\p{L}\p{N}]+/gu;

function holdFor(text: string): number {
  return HOLD_BASE_MS + (text.match(WORD)?.length ?? 0) * HOLD_PER_WORD_MS;
}

export function timelineOf(lines: LyricLine[]): LyricRow[] {
  const rows: LyricRow[] = [];
  for (const { timeMs, text } of lines) {
    const last = rows.at(-1);
    if (last !== undefined && last.stopMs === Infinity) {
      if (text !== '' && timeMs - last.startMs < MERGE_WITHIN_MS) {
        last.text = `${last.text}\n${text}`;
        continue;
      }
      last.stopMs = timeMs;
    }
    if (text !== '') rows.push({ startMs: timeMs, stopMs: Infinity, text });
  }
  return rows.map((row) => ({ ...row, stopMs: Math.min(row.stopMs, row.startMs + holdFor(row.text)) }));
}

export type LineAt = {
  /** The row to keep in place: the last one to have started, or the first while none has. */
  index: number;
  isLit: boolean;
  /** How long until any of this changes. */
  changesInMs: number;
};

function lastStarted(rows: LyricRow[], timeMs: number): number {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((rows[middle]?.startMs ?? Infinity) <= timeMs) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

export function lineAt(rows: LyricRow[], timeMs: number): LineAt {
  const index = lastStarted(rows, timeMs);
  const nextStart = rows[index + 1]?.startMs ?? Infinity;
  const stop = rows[index]?.stopMs ?? -Infinity;
  const isLit = timeMs < stop;
  return {
    index: Math.max(index, 0),
    isLit,
    changesInMs: Math.min(nextStart, isLit ? stop : Infinity) - timeMs,
  };
}

export function formatOffset(offsetMs: number): string {
  const seconds = offsetMs / 1000;
  return `${seconds > 0 ? '+' : ''}${seconds} s`;
}
