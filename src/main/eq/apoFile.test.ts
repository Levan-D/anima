import { describe, expect, it } from 'vitest';
import { EQ_AUTO_PREAMP, type EqBand } from '@shared/domain';
import { parseApoFile, writeApoFile } from './apoFile';

const BANDS: EqBand[] = [
  { id: 1, kind: 'peak', frequencyHz: 120, gainDb: 3, q: 1.4 },
  { id: 2, kind: 'highshelf', frequencyHz: 8000, gainDb: -2, q: 0.7 },
  { id: 3, kind: 'lowshelf', frequencyHz: 80.5, gainDb: 1.5, q: 0.71 },
];

const failure = (text: string) => {
  const result = parseApoFile(text);
  return result.ok ? null : result.error.message;
};

describe('the APO file', () => {
  it('writes the effective preamp, and reads it back as a value set by hand', () => {
    const text = writeApoFile(BANDS, EQ_AUTO_PREAMP);
    const written = Number(/^Preamp: (-[\d.]+) dB/.exec(text)?.[1]);
    expect(written).toBeLessThan(0);
    expect(text).toContain('Filter 1: ON PK Fc 120 Hz Gain 3 dB Q 1.4');
    expect(text).toContain('Filter 2: ON HSC Fc 8000 Hz Gain -2 dB Q 0.7');
    expect(parseApoFile(text)).toEqual({
      ok: true,
      value: { bands: BANDS, preamp: { auto: false, db: written }, clampedBands: 0 },
    });
    expect(writeApoFile(BANDS, { auto: false, db: 2.5 })).toMatch(/^Preamp: 2.5 dB/);
  });

  it('leaves Auto on without a Preamp line, and clamps too much rather than refuse', () => {
    const none = parseApoFile('Filter 1: ON PK Fc 100 Hz Gain 1 dB Q 1');
    expect(none.ok && none.value.preamp).toEqual(EQ_AUTO_PREAMP);

    const over = parseApoFile('Preamp: -40 dB\nFilter 1: ON PK Fc 100 Hz Gain 99 dB Q 1\nFilter 2: ON PK Fc 200 Hz Gain -13 dB Q 1');
    expect(over.ok && over.value.bands.map(({ gainDb }) => gainDb)).toEqual([12, -12]);
    expect(over.ok && over.value.clampedBands).toBe(2);
    expect(over.ok && over.value.preamp).toEqual({ auto: false, db: -24 });
  });

  it('takes every kind, in any case and spacing, and skips comments, blanks, OFF and the preamp', () => {
    const text = [
      '# AutoEQ',
      '',
      'preamp:   -6.2 DB',
      'filter 1: on pk fc 100 hz gain 1 db q 1',
      'Filter  2 :  ON   PEQ  Fc 200 Hz  Gain -1 dB  Q 2',
      'Filter 3: OFF PK Fc 300 Hz Gain 9 dB Q 1',
      'Filter 4: ON LS Fc 50 Hz Gain 1 dB Q 0.5',
      'Filter 5: ON LSC Fc 60 Hz Gain 1 dB',
      'Filter 6: ON HS Fc 9000 Hz Gain 1 dB Q 0.5',
      'Filter 7: ON HSC Fc 10000 Hz Gain 1 dB Q 0.5',
    ].join('\n');
    const result = parseApoFile(text);
    expect(result.ok && result.value.bands.map(({ kind }) => kind)).toEqual([
      'peak',
      'peak',
      'lowshelf',
      'lowshelf',
      'highshelf',
      'highshelf',
    ]);
    expect(result.ok && result.value.bands[3]?.q).toBe(0.707);
  });

  it('refuses the whole file, naming the line', () => {
    expect(failure('# ok\nnonsense')).toContain('Line 2');
    expect(failure('Filter 1: ON LP Fc 100 Hz Gain 1 dB Q 1')).toContain('Line 1');
    expect(failure('\n\nFilter 1: ON PK Fc 5 Hz Gain 1 dB Q 1')).toContain('Line 3');
    expect(failure('Filter 1: ON PK Fc 100 Hz Gain 1 dB Q 50')).toContain('Q');
  });

  it('refuses more than ten bands, and a file with none', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `Filter ${i}: ON PK Fc 100 Hz Gain 1 dB Q 1`).join('\n');
    expect(failure(eleven)).toContain('Line 11');
    expect(failure('Preamp: -1 dB')).toContain('no filters');
  });
});
