/* These files are made up here. No third party's numbers belong in this repo. */

import { describe, expect, it } from 'vitest';
import { parseResponseFile } from './responseFile';

const POINTS: readonly (readonly [number, number])[] = [
  [20, -4.5],
  [100, -1],
  [300, 0.25],
  [1000, 1],
  [3000, 8],
  [6000, 2.5],
  [10_000, -3],
  [20_000, -12],
];

const csv = POINTS.map(([hz, db]) => `${hz},${db}`);
const tsv = POINTS.map(([hz, db]) => `${hz}\t${db}\t0.0`);

function parsed(text: string) {
  const result = parseResponseFile(text);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function refusal(text: string): string {
  const result = parseResponseFile(text);
  if (result.ok) throw new Error('It should have been refused');
  return result.error.message;
}

describe('parseResponseFile', () => {
  it('reads AutoEq-style CSV', () => {
    const { hz, db } = parsed(['frequency,raw', ...csv].join('\n'));
    expect(hz).toEqual(POINTS.map(([at]) => at));
    expect(db).toEqual(POINTS.map(([, value]) => value));
  });

  it('reads the raw column wherever it is in a results CSV', () => {
    const rows = POINTS.map(([hz, db]) => `${hz},9,${db},7`);
    const { db } = parsed(['frequency,smoothed,raw,error', ...rows].join('\n'));
    expect(db).toEqual(POINTS.map(([, value]) => value));
  });

  it("reads REW's text, with its comment lines and three columns", () => {
    const text = [
      '* Measurement data measured by REW V5.20',
      '* Source: made up',
      '* Format: 1/48 octave smoothing',
      '* Freq(Hz)\tSPL(dB)\tPhase(degrees)',
      ...tsv,
    ].join('\r\n');
    expect(parsed(text).db).toEqual(POINTS.map(([, value]) => value));
  });

  it('reads tab-separated text with a line of names and no comment mark', () => {
    expect(parsed(['Frequency\tSPL', ...tsv].join('\n')).hz).toHaveLength(POINTS.length);
  });

  it('reads a comma followed by a space', () => {
    const text = POINTS.map(([hz, db]) => `${hz}, ${db}`).join('\n');
    expect(parsed(`* Freq(Hz), SPL(dB)\n${text}`).hz).toHaveLength(POINTS.length);
  });

  it('reads space-separated text with no header', () => {
    const text = POINTS.map(([hz, db]) => `${hz} ${db}`).join('\n');
    expect(parsed(text).hz).toHaveLength(POINTS.length);
  });

  it('takes a byte order mark and blank lines', () => {
    expect(parsed(`${String.fromCharCode(0xfeff)}frequency,raw\n\n${csv.join('\n\n')}\n`).hz).toHaveLength(
      POINTS.length,
    );
  });

  it('reads exponents', () => {
    const { hz } = parsed(['frequency,raw', '2e1,0', ...csv.slice(1)].join('\n'));
    expect(hz[0]).toBe(20);
  });

  it('names the line it stops on', () => {
    expect(refusal(['frequency,raw', '20,1', '100,nope', ...csv.slice(2)].join('\n'))).toBe(
      'Line 3: can\'t read "nope" as a level',
    );
    expect(refusal(['frequency,raw', '20,1', 'x,1'].join('\n'))).toContain('Line 3');
  });

  it('counts comment and blank lines in the number, so it matches an editor', () => {
    expect(refusal(['* a comment', '', 'frequency,raw', '20,1', 'wat,1'].join('\n'))).toContain('Line 5');
  });

  it('refuses frequencies that go backwards or repeat', () => {
    expect(refusal(['20,1', '100,1', '100,2'].join('\n'))).toContain('Line 3: the frequencies have to go up');
    expect(refusal(['100,1', '20,1'].join('\n'))).toContain('Line 2');
  });

  it('refuses a column of words that names no level', () => {
    expect(refusal(['name,comment', ...csv].join('\n'))).toContain('Line 1: this needs a frequency column');
  });

  it('refuses a line with no level', () => {
    expect(refusal(['20,1', '100'].join('\n'))).toBe('Line 2: it has no level');
  });

  it('refuses words in the middle', () => {
    expect(refusal(['20,1', '100,1', 'frequency,raw'].join('\n'))).toContain('Line 3');
  });

  it('refuses decimal commas rather than reading them as another column', () => {
    expect(refusal(['20,5\t-1,5', ...tsv.slice(1)].join('\n'))).toContain('commas for decimals');
  });

  it('refuses values no real response has', () => {
    expect(refusal('0.5,1')).toContain('out of range');
    expect(refusal('200000,1')).toContain('out of range');
    expect(refusal('20,9999')).toContain('out of range');
  });

  it('refuses a number written as something else', () => {
    expect(refusal('20,Infinity')).toContain("can't read");
    expect(refusal('20,NaN')).toContain("can't read");
    expect(refusal('0x10,1')).toContain("can't read");
  });

  it('refuses too few points', () => {
    expect(refusal('20,1\n1000,1')).toContain('It needs at least');
    expect(refusal('')).toContain('0 points');
  });

  it('refuses a file that misses the alignment band', () => {
    const lows = Array.from({ length: 10 }, (_, point) => `${20 + point * 10},1`);
    expect(refusal(lows.join('\n'))).toContain('It has to span 300 Hz to 3 kHz');
  });

  it('refuses too many points', () => {
    const lines = Array.from({ length: 200_001 }, (_, point) => `${1 + point * 0.1},1`);
    expect(refusal(lines.join('\n'))).toContain('Line 200001: there can be at most 200000 points');
  });
});
