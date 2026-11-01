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
  });

  // Equalizer APO's BiQuadFilterFactory.cpp: no Q on a shelf is a slope of 0.9, on the frequency given.
  it('reads a shelf with no Q the way APO does, as a slope of 0.9', () => {
    const result = parseApoFile(
      'Filter 1: ON LSC Fc 60 Hz Gain 6 dB\nFilter 2: ON HS Fc 9000 Hz Gain -12 dB\nFilter 3: ON LS Fc 60 Hz Gain 0 dB',
    );
    const slopeQ = (gainDb: number) => {
      const A = 10 ** (gainDb / 40);
      return 1 / Math.sqrt((A + 1 / A) * (1 / 0.9 - 1) + 2);
    };
    expect(result.ok && result.value.bands.map(({ frequencyHz }) => frequencyHz)).toEqual([60, 9000, 60]);
    const qs = result.ok ? result.value.bands.map(({ q }) => q) : [];
    expect(qs[0]).toBeCloseTo(slopeQ(6), 3);
    expect(qs[1]).toBeCloseTo(slopeQ(-12), 3);
    expect(qs[2]).toBeCloseTo(0.671, 3);
  });

  // BiQuadFilter.cpp: `centerFreqFactor = 10^(|gain| / 80 / s)`, up for a low shelf and down for a high one.
  it('moves a plain LS or HS with a Q from its corner to its centre, and leaves LSC and HSC alone', () => {
    const result = parseApoFile(
      [
        'Filter 1: ON LS Fc 100 Hz Gain 6 dB Q 0.7071',
        'Filter 2: ON HS Fc 8000 Hz Gain -6 dB Q 0.7071',
        'Filter 3: ON LSC Fc 100 Hz Gain 6 dB Q 0.7071',
        'Filter 4: ON HSC Fc 8000 Hz Gain -6 dB Q 0.7071',
      ].join('\n'),
    );
    const hz = result.ok ? result.value.bands.map(({ frequencyHz }) => frequencyHz) : [];
    expect(hz[0]).toBeCloseTo(100 * 10 ** (6 / 80), 0);
    expect(hz[1]).toBeCloseTo(8000 / 10 ** (6 / 80), 0);
    expect(hz.slice(2)).toEqual([100, 8000]);
  });

  it('refuses a plain shelf whose centre would land outside the range', () => {
    expect(failure('Filter 1: ON LS Fc 19000 Hz Gain 12 dB Q 0.5')).toContain('centre');
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
