/* A frequency response as a text file: `frequency,raw` CSV, as AutoEq's are, or tab-separated text from Room EQ Wizard. Pure. */

import type { FrCurve } from '@shared/headphone';
import { err, ok, type Result } from '@shared/result';

export const RESPONSE_FILE_MAX_BYTES = 8 * 1024 * 1024;

const MOST_POINTS = 200_000;
const LEAST_POINTS = 8;
const LOWEST_HZ = 1;
const HIGHEST_HZ = 100_000;
const FURTHEST_DB = 300;
// Enough to align it by, and to mean anything on the plot. The alignment band is 300 Hz to 3 kHz.
const MUST_REACH_LOW_HZ = 300;
const MUST_REACH_HIGH_HZ = 3000;

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
// REW starts its files with lines like this, and squig.link's own often have a line of column names.
const COMMENT = /^[*#;]/;
const WORDS_FIRST = /^[\p{L}"]/u;
const COLUMNS = /\s*[,;\t]\s*|\s+/;

function fail(line: number, why: string): Result<never> {
  return err('invalid_eq_file', `Line ${line}: ${why}`);
}

function headerColumns(line: string): string[] {
  return line
    .split(COLUMNS)
    .map((word) => word.replaceAll('"', '').trim().toLowerCase())
    .filter((word) => word !== '');
}

const FREQUENCY_NAMES = /^(freq|frequency|hz|freq\(hz\)|frequency\(hz\))$/;
const LEVEL_NAMES = /^(raw|spl|spl\(db\)|db|level|magnitude|amplitude|gain)$/;

/** Which column holds the level, from a line of column names. Null if it doesn't name one it can believe. */
function levelColumn(columns: readonly string[]): number | null {
  if (!FREQUENCY_NAMES.test(columns[0] ?? '')) return null;
  const at = columns.findIndex((name, index) => index > 0 && LEVEL_NAMES.test(name));
  return at === -1 ? null : at;
}

const DECIMAL_COMMA = /^\s*\d+,\d+\s+-?\d+,\d+/;

/**
 * Refuses the whole file, saying which line, on anything it can't read. A response is frequency and level, with frequency always
 * going up, in dB rather than a ratio. It doesn't need to be at any particular level, since it's aligned afterwards.
 */
export function parseResponseFile(text: string): Result<FrCurve> {
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/);
  const hz: number[] = [];
  const db: number[] = [];
  let column = 1;

  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    const number = index + 1;
    if (line === '' || COMMENT.test(line)) continue;

    if (WORDS_FIRST.test(line)) {
      if (hz.length > 0) return fail(number, `can't read "${line.slice(0, 60)}"`);
      const named = levelColumn(headerColumns(line));
      if (named === null)
        return fail(number, 'this needs a frequency column and a level column, such as frequency,raw');
      column = named;
      continue;
    }

    if (DECIMAL_COMMA.test(line)) return fail(number, 'this uses commas for decimals, so export it with points');
    const columns = line.split(COLUMNS);
    const frequency = columns[0] ?? '';
    const level = columns[column] ?? '';
    if (!NUMBER.test(frequency)) return fail(number, `can't read "${frequency.slice(0, 30)}" as a frequency`);
    if (level === '') return fail(number, 'it has no level');
    if (!NUMBER.test(level)) return fail(number, `can't read "${level.slice(0, 30)}" as a level`);

    const hzValue = Number(frequency);
    const dbValue = Number(level);
    if (hzValue < LOWEST_HZ || hzValue > HIGHEST_HZ) return fail(number, `${frequency} Hz is out of range`);
    if (Math.abs(dbValue) > FURTHEST_DB) return fail(number, `${level} dB is out of range`);
    const last = hz.at(-1);
    if (last !== undefined && hzValue <= last)
      return fail(number, 'the frequencies have to go up, one line after another');
    if (hz.length === MOST_POINTS) return fail(number, `there can be at most ${MOST_POINTS} points`);
    hz.push(hzValue);
    db.push(dbValue);
  }

  if (hz.length < LEAST_POINTS)
    return err('invalid_eq_file', `That file has ${hz.length} points. It needs at least ${LEAST_POINTS}.`);
  const first = hz[0] ?? 0;
  const last = hz.at(-1) ?? 0;
  if (first > MUST_REACH_LOW_HZ || last < MUST_REACH_HIGH_HZ) {
    return err(
      'invalid_eq_file',
      `That file only covers ${first} to ${last} Hz. It has to span 300 Hz to 3 kHz at least.`,
    );
  }
  return ok({ hz, db });
}
