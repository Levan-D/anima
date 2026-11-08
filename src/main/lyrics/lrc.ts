/* Turns the text of lyrics, however it was written down, into lines to show. Pure. */

import type { LyricLine } from '@shared/domain';

export type ParsedLyrics = {
  synced: LyricLine[] | null;
  plain: string | null;
};

const LINE_END = /\r\n|\r|\n/;
const LEADING_STAMP = /^\s*\[(\d{1,3}):(\d{1,3}(?:[.:]\d{1,3})?)\]/;
const ANY_STAMP = /\[\d{1,3}:\d{1,3}(?:[.:]\d{1,3})?\]/g;
const WORD_TAG = /<\d{1,3}:\d{1,3}(?:[.:]\d{1,3})?>/g;
// Known keys only: a general [word: ...] would eat labels that are part of the words.
const TAG_LINE = /^\s*\[(?:ar|al|ti|au|lr|by|re|ve|id|tool|length|offset):[^\]]*\]\s*$/i;
const OFFSET_TAG = /^\s*\[offset:\s*([+-]?\d+)\s*\]\s*$/i;
const HAS_WORDS = /[\p{L}\p{N}]/u;
const C1 = /[\u0080-\u009f]/g;
const WORD = /[\p{L}\p{N}]+/gu;
const BRACKETED = /\[[^\]]*\]/g;
// Uploads carry values as far off as -47 s, which were never a correction to these stamps.
const MOST_BELIEVABLE_OFFSET_MS = 5_000;

const windows1252 = new TextDecoder('windows-1252');

// U+0092 and friends are windows-1252 bytes that were read as Latin-1. Five of those bytes mean nothing, so they go.
function mapC1(char: string): string {
  const mapped = windows1252.decode(Uint8Array.of(char.charCodeAt(0)));
  return mapped === char ? '' : mapped;
}

function cleanLine(line: string): string {
  return line
    .replace(/\ufeff/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(C1, mapC1)
    .trim();
}

function linesOf(text: string): string[] {
  return text.split(LINE_END).map(cleanLine);
}

function stampMs(minutes: string | undefined, seconds: string | undefined): number {
  return Math.round((Number(minutes) * 60 + Number(seconds?.replace(':', '.'))) * 1000);
}

/** Every stamp at the front of the line, then what's left with any other stamps and word tags taken out. */
function readLine(line: string): { stamps: number[]; words: string } {
  const stamps: number[] = [];
  let rest = line;
  for (let stamp = LEADING_STAMP.exec(rest); stamp !== null; stamp = LEADING_STAMP.exec(rest)) {
    stamps.push(stampMs(stamp[1], stamp[2]));
    rest = rest.slice(stamp[0].length);
  }
  return { stamps, words: rest.replace(ANY_STAMP, '').replace(WORD_TAG, '').replace(/\s+/g, ' ').trim() };
}

/** A positive offset makes lyrics appear sooner, by the format's own definition. */
function offsetIn(lines: string[]): number {
  for (const line of lines) {
    const value = OFFSET_TAG.exec(line)?.[1];
    if (value !== undefined) return Math.abs(Number(value)) <= MOST_BELIEVABLE_OFFSET_MS ? Number(value) : 0;
  }
  return 0;
}

function collapseBlankRuns(lines: string[]): string | null {
  const kept = lines.filter((line, index) => line !== '' || (index > 0 && lines[index - 1] !== ''));
  const text = kept.join('\n').trim();
  return text === '' ? null : text;
}

/** The words alone, with stamps, word tags and known tag lines gone. Blank lines stay, since they part the verses. */
export function plainFrom(text: string): string | null {
  const lines = linesOf(text)
    .filter((line) => !TAG_LINE.test(line))
    .map((line) => readLine(line).words);
  return collapseBlankRuns(lines);
}

function timedLines(lines: string[]): LyricLine[] {
  const shift = offsetIn(lines);
  const entries: { stamps: number[]; words: string }[] = [];
  for (const line of lines) {
    if (line === '' || TAG_LINE.test(line)) continue;
    const { stamps, words } = readLine(line);
    const previous = entries.at(-1);
    if (stamps.length > 0) entries.push({ stamps, words });
    // A line with no stamp carries on from the one above it. Before the first stamp, it's nobody's.
    else if (previous !== undefined) previous.words = `${previous.words}\n${words}`.trim();
  }

  // toSorted is stable, which is what keeps two lines on one stamp in the order they were written.
  const timed = entries
    .flatMap(({ stamps, words }) =>
      stamps.map((stamp) => ({
        timeMs: Math.max(0, stamp - shift),
        text: HAS_WORDS.test(words) ? words : '',
      })),
    )
    .toSorted((a, b) => a.timeMs - b.timeMs);

  const joined: LyricLine[] = [];
  for (const line of timed) {
    const last = joined.at(-1);
    if (last?.timeMs === line.timeMs) last.text = [last.text, line.text].filter(Boolean).join('\n');
    else joined.push(line);
  }
  return joined;
}

export function parseLrc(text: string): ParsedLyrics {
  const synced = timedLines(linesOf(text));
  return { synced: synced.some((line) => line.text !== '') ? synced : null, plain: plainFrom(text) };
}

/** Bracketed labels aren't words someone sings. */
export function countWords(text: string): number {
  return text.replace(BRACKETED, ' ').match(WORD)?.length ?? 0;
}

/** A timed line lasts until the next, but no longer than this: a longer gap is a stretch with nobody singing. */
const LONGEST_LINE_MS = 10_000;
/** The last line, with nothing after it to say when it ends. */
const LAST_LINE_MS = 4_000;

/** How much of a song is sung, 0 to 1, from its timed lines. It never needs the words, only whether a line has any. */
export function sungShare(lines: readonly LyricLine[], durationMs: number): number {
  if (durationMs <= 0) return 0;
  let sungMs = 0;
  lines.forEach((line, index) => {
    if (line.text === '') return;
    const end = lines[index + 1]?.timeMs ?? line.timeMs + LAST_LINE_MS;
    sungMs += Math.min(LONGEST_LINE_MS, Math.max(0, end - line.timeMs));
  });
  return Math.min(1, sungMs / durationMs);
}
