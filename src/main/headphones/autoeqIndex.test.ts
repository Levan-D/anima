/* The index's shape, on names made up here. */

import { describe, expect, it } from 'vitest';
import { AUTOEQ_COMMIT } from '@shared/headphone';
import { measurementUrls, parseAutoEqIndex, presetUrl, rigOf, searchAutoEq, targetUrl } from './autoeqIndex';

const INDEX = [
  '# Index',
  'This is a list of all equalization profiles. Target is in parentheses if there are results with multiple targets',
  '',
  '- [Acme One](./oratory1990/over-ear/Acme%20One) by oratory1990',
  '- [Acme One](./Rtings/HMS%20II.3%20over-ear/Acme%20One) by Rtings on HMS II.3',
  '- [Acme Two (ANC on)](./HypetheSonics/GRAS%20RA0045%20in-ear/Acme%20Two%20(ANC%20on)) by HypetheSonics on GRAS RA0045',
  "- [Ted's Bud](./Ted's%20Squig%20Hoard/in-ear/Ted's%20Bud) by Ted's Squig Hoard",
  '- [Acme & Sons by Foo](./Rtings/Bruel%20&%20Kjaer%205128%20over-ear/Acme%20&%20Sons%20by%20Foo) by Rtings on Bruel & Kjaer 5128',
  '- [Acme In](./crinacle/711%20in-ear/Acme%20In) by crinacle on 711',
  '- [Mystery](./Nobody/over-ear/Mystery) by Nobody',
  '- [Escape](./oratory1990/over-ear/..%2F..%2Fescape) by oratory1990',
  '- [Dots](./../over-ear/Dots) by nobody',
  '- [No form](./oratory1990/headset/No%20form) by oratory1990',
].join('\n');

const entries = parseAutoEqIndex(INDEX);
const named = (name: string, source?: string) => {
  const found = entries.find((one) => one.name === name && (source === undefined || one.source === source));
  if (found === undefined) throw new Error(`No ${name}`);
  return found;
};

describe('parseAutoEqIndex', () => {
  it("reads the source, form and rig from the link, and skips what isn't a line", () => {
    expect(entries.map(({ name }) => name)).toEqual([
      'Acme One',
      'Acme One',
      'Acme Two (ANC on)',
      "Ted's Bud",
      'Acme & Sons by Foo',
      'Acme In',
      'Mystery',
    ]);
    expect(named('Acme Two (ANC on)')).toMatchObject({ source: 'HypetheSonics', form: 'in-ear' });
  });

  it('refuses anything that would step out of its folder', () => {
    expect(entries.some(({ name }) => name.includes('..'))).toBe(false);
  });

  it('gives each a lasting id', () => {
    expect(entries.map(({ id }) => id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('marks the sources with only presets', () => {
    expect(named('Acme In').isPresetOnly).toBe(true);
    expect(named('Acme One', 'oratory1990').isPresetOnly).toBe(false);
  });
});

describe('rigOf', () => {
  it('takes the folder at its word', () => {
    expect(named('Acme One', 'Rtings').rig).toEqual({ family: 'hms', detail: 'HMS II.3' });
    expect(named('Acme & Sons by Foo').rig).toEqual({ family: 'bk5128', detail: 'Bruel & Kjaer 5128' });
    expect(named('Acme Two (ANC on)').rig).toEqual({ family: 'iec711-coupler', detail: 'GRAS RA0045' });
    expect(named('Acme In').rig).toEqual({ family: 'iec711-coupler', detail: '711' });
  });

  it("falls back on AutoEq's per-source rigs", () => {
    expect(named('Acme One', 'oratory1990').rig).toEqual({ family: 'iec711-pinna', detail: 'GRAS 43AG' });
    expect(named("Ted's Bud").rig).toEqual({ family: 'iec711-coupler', detail: '711' });
    expect(rigOf('Filk', 'over-ear', null)).toEqual({ family: 'iec711-pinna', detail: 'KB006x + 711' });
    expect(rigOf('Innerfidelity', 'over-ear', null).family).toBe('hms');
    expect(rigOf('HypetheSonics', 'over-ear', null).family).toBe('bk5128');
  });

  it("says unknown when nothing says, and doesn't guess", () => {
    expect(named('Mystery').rig).toEqual({ family: 'unknown', detail: null });
    expect(rigOf('Filk', 'earbud', null).family).toBe('unknown');
    expect(rigOf('Nobody', 'over-ear', 'A rig of mine')).toEqual({ family: 'unknown', detail: null });
  });

  it('keeps EARS apart from the rig it sits on', () => {
    expect(rigOf('crinacle', 'over-ear', 'EARS + 711').family).toBe('ears');
    expect(rigOf('crinacle', 'over-ear', 'GRAS 43AG-7').family).toBe('iec711-pinna');
  });
});

describe('the URLs', () => {
  const base = `https://raw.githubusercontent.com/jaakkopasanen/AutoEq/${AUTOEQ_COMMIT}`;

  it('are all at the pinned commit', () => {
    expect(measurementUrls(named('Acme One', 'oratory1990'))).toEqual([
      `${base}/measurements/oratory1990/data/over-ear/Acme%20One.csv`,
    ]);
    expect(targetUrl('Diffuse field 5128 -1dB per octave')).toBe(
      `${base}/targets/Diffuse%20field%205128%20-1dB%20per%20octave.csv`,
    );
  });

  it('put a rig between form and name in the measurements', () => {
    expect(measurementUrls(named('Acme & Sons by Foo'))[0]).toBe(
      `${base}/measurements/Rtings/data/over-ear/Bruel%20%26%20Kjaer%205128/Acme%20%26%20Sons%20by%20Foo.csv`,
    );
  });

  it('try both spellings of the Rtings folder', () => {
    expect(measurementUrls(named('Acme One', 'Rtings'))[1]).toBe(
      `${base}/measurements/rtings/data/over-ear/HMS%20II.3/Acme%20One.csv`,
    );
  });

  it('name a preset after the folder', () => {
    expect(presetUrl(named('Acme In'))).toBe(
      `${base}/results/crinacle/711%20in-ear/Acme%20In/Acme%20In%20ParametricEQ.txt`,
    );
  });
});

describe('searchAutoEq', () => {
  it('finds every word in any order, whatever the case', () => {
    expect(searchAutoEq(entries, 'one ACME').entries.map(({ source }) => source)).toEqual(['oratory1990', 'Rtings']);
  });

  it('finds by source too', () => {
    expect(searchAutoEq(entries, 'acme rtings').total).toBe(2);
  });

  it('finds nothing for nothing', () => {
    expect(searchAutoEq(entries, '   ')).toEqual({ entries: [], total: 0 });
  });

  it('says how many there were when it stops early', () => {
    const many = parseAutoEqIndex(
      Array.from({ length: 100 }, (_, n) => `- [Acme ${n}](./oratory1990/over-ear/Acme%20${n}) by oratory1990`).join(
        '\n',
      ),
    );
    const found = searchAutoEq(many, 'acme');
    expect(found.total).toBe(100);
    expect(found.entries).toHaveLength(60);
  });

  it('sends only what the screen needs', () => {
    expect(Object.keys(searchAutoEq(entries, 'mystery').entries[0] ?? {})).not.toContain('resultsPath');
  });
});
