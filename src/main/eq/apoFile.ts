/* A preset as a plain text file in Equalizer APO's format, which is what AutoEQ's headphone profiles come in. Pure. */

import {
  EQ_AUTO_PREAMP,
  EQ_MAX_BANDS,
  EQ_MAX_GAIN_DB,
  EQ_MAX_HZ,
  EQ_MAX_PREAMP_DB,
  EQ_MAX_Q,
  EQ_MIN_HZ,
  EQ_MIN_PREAMP_DB,
  EQ_MIN_Q,
  type EqBand,
  type EqBandKind,
  type EqPreamp,
} from '@shared/domain';
import { effectivePreampDb } from '@shared/eqCurve';
import { err, ok, type Result } from '@shared/result';

const KINDS: Record<string, EqBandKind> = {
  PK: 'peak',
  PEQ: 'peak',
  LS: 'lowshelf',
  LSC: 'lowshelf',
  HS: 'highshelf',
  HSC: 'highshelf',
};
const WRITTEN_KINDS: Record<EqBandKind, string> = { peak: 'PK', lowshelf: 'LSC', highshelf: 'HSC' };
/** What a shelf gets when a file gives none, as it may. */
const SHELF_Q = 0.707;

const FILTER_LINE =
  /^filter(?:\s*\d+)?\s*:\s*(on|off)\s+([a-z]+)(?:\s+fc\s+([-\d.]+)\s*hz\s+gain\s+([-\d.]+)\s*db(?:\s+q\s+([-\d.]+))?)?\s*$/i;
const PREAMP_LINE = /^preamp\s*:\s*([-+\d.]+)\s*db\s*$/i;

function fail(line: number, why: string): Result<never> {
  return err('invalid_eq_file', `Line ${line}: ${why}`);
}

function inRange(value: number, low: number, high: number): boolean {
  return Number.isFinite(value) && value >= low && value <= high;
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

export type ApoPreset = {
  bands: EqBand[];
  /** A Preamp line turns Auto off at its value. Without one it stays on. */
  preamp: EqPreamp;
  /** How many bands asked for more gain than there is, and got the most there is. */
  clampedBands: number;
};

/** Refuses the whole file, saying which line, on anything it can't read. Too much gain or preamp is only brought down. */
export function parseApoFile(text: string): Result<ApoPreset> {
  const bands: EqBand[] = [];
  let preamp = EQ_AUTO_PREAMP;
  let clampedBands = 0;
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/);

  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    const number = index + 1;
    if (line === '' || line.startsWith('#')) continue;

    const preampLine = PREAMP_LINE.exec(line);
    if (preampLine !== null) {
      const db = Number(preampLine[1]);
      if (!Number.isFinite(db)) return fail(number, `can't read "${line}"`);
      preamp = { auto: false, db: clamp(db, EQ_MIN_PREAMP_DB, EQ_MAX_PREAMP_DB) };
      continue;
    }

    const match = FILTER_LINE.exec(line);
    if (match === null) return fail(number, `can't read "${line}"`);
    const [, state, type, hz, gain, q] = match;
    if (state?.toUpperCase() === 'OFF') continue;

    const kind = KINDS[type?.toUpperCase() ?? ''];
    if (kind === undefined) return fail(number, `can't use a ${type} filter`);
    if (hz === undefined || gain === undefined) return fail(number, 'it needs a frequency and a gain');
    if (q === undefined && kind === 'peak') return fail(number, 'a peak needs a Q');

    const band: EqBand = {
      id: bands.length + 1,
      kind,
      frequencyHz: Number(hz),
      gainDb: Number(gain),
      q: q === undefined ? SHELF_Q : Number(q),
    };
    if (!inRange(band.frequencyHz, EQ_MIN_HZ, EQ_MAX_HZ)) {
      return fail(number, `the frequency has to be from ${EQ_MIN_HZ} to ${EQ_MAX_HZ} Hz`);
    }
    if (!Number.isFinite(band.gainDb)) return fail(number, "can't read the gain");
    if (Math.abs(band.gainDb) > EQ_MAX_GAIN_DB) {
      band.gainDb = clamp(band.gainDb, -EQ_MAX_GAIN_DB, EQ_MAX_GAIN_DB);
      clampedBands++;
    }
    if (!inRange(band.q, EQ_MIN_Q, EQ_MAX_Q)) return fail(number, `Q has to be from ${EQ_MIN_Q} to ${EQ_MAX_Q}`);
    if (bands.length === EQ_MAX_BANDS) return fail(number, `there can be at most ${EQ_MAX_BANDS} bands`);
    bands.push(band);
  }

  return bands.length === 0
    ? err('invalid_eq_file', 'There are no filters in that file')
    : ok({ bands, preamp, clampedBands });
}

/** The Preamp line says what's really applied, so the file sounds the same in anything else that reads it. */
export function writeApoFile(bands: EqBand[], preamp: EqPreamp): string {
  const filters = bands.map(
    ({ kind, frequencyHz, gainDb, q }, index) =>
      `Filter ${index + 1}: ON ${WRITTEN_KINDS[kind]} Fc ${frequencyHz} Hz Gain ${gainDb} dB Q ${q}`,
  );
  return `${[`Preamp: ${effectivePreampDb({ bands, preamp })} dB`, ...filters].join('\r\n')}\r\n`;
}
