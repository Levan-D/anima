/* What may be drawn, and the exact words from docs/research/headphone-eq.md. Curves are made up here. */

import { describe, expect, it } from 'vitest';
import { yOfGain } from '@/features/Equalizer/utils/eqBands';
import {
  fixedLines,
  linePath,
  matchOf,
  measuredWords,
  whatsOffWords,
  predictedWords,
  targetWords,
  type HeadphoneInputs,
} from '@/features/Equalizer/utils/headphoneLines';
import { MATCH_DEFAULTS, type FrCurve, type HeadphoneMeasurement, type HeadphoneTarget } from '@shared/headphone';

const curve: FrCurve = (() => {
  const hz = Array.from({ length: 200 }, (_, point) => 20 * 1000 ** (point / 199));
  return { hz, db: hz.map((at) => 70 + 3 * Math.sin(Math.log2(at))) };
})();

const measurement: HeadphoneMeasurement = {
  id: 1,
  headphone: 'HD 660 S',
  source: 'oratory1990',
  rig: { family: 'iec711-pinna', detail: 'GRAS' },
  origin: { kind: 'file' },
  hasCurve: true,
  hasPreset: false,
  match: MATCH_DEFAULTS,
};

const target: HeadphoneTarget = {
  id: 2,
  name: 'Harman over-ear 2018',
  source: 'AutoEq',
  rig: { family: 'bk5128', detail: 'Elsewhere' },
  isTranslated: false,
  origin: { kind: 'file' },
};

const inputs = (over: Partial<HeadphoneInputs>): HeadphoneInputs => ({
  measurement: curve,
  target: curve,
  match: 'approximate',
  showRaw: false,
  showDifference: false,
  bassDb: 0,
  ...over,
});

describe('fixedLines', () => {
  it('hides a target on another rig, or one nobody can place, and any difference view with it', () => {
    for (const match of ['different', 'unknown'] as const) {
      const lines = fixedLines(inputs({ match, showDifference: true }));
      expect(lines.target).toBeNull();
      expect(lines.isTargetShown).toBe(false);
      expect(lines.isDifference).toBe(false);
    }
  });

  it('shows one that matches, for both states', () => {
    for (const match of ['defined', 'approximate'] as const) {
      expect(fixedLines(inputs({ match })).target).not.toBeNull();
    }
  });

  it('turns a line on its own target into 0, and takes the target line away', () => {
    const lines = fixedLines(inputs({ showDifference: true }));
    expect(lines.isDifference).toBe(true);
    expect(lines.target).toBeNull();
    expect(Math.max(...(lines.measured?.db ?? []).map(Math.abs))).toBeLessThan(0.01);
  });

  it('widens the scale past the EQ only when there is a measurement', () => {
    expect(fixedLines(inputs({ measurement: null })).rangeDb).toBe(12);
    expect(fixedLines(inputs({})).rangeDb).toBeGreaterThanOrEqual(18);
  });
});

describe('linePath', () => {
  it('uses one scale, so a line sits where the plot says', () => {
    const start = linePath({ hz: [20, 20_000], db: [6, -6] }, 24).split('L')[0];
    expect(start).toBe(`M0.0 ${(yOfGain(6, 24) * 1000).toFixed(1)}`);
  });

  it('leaves out what is off the axis', () => {
    expect(linePath({ hz: [10, 25_000], db: [0, 0] }, 24)).toBe('');
  });
});

describe('what is off, and why', () => {
  const curve = { source: 'oratory1990', hasCurve: true } as HeadphoneMeasurement;
  const presetOnly = { source: 'crinacle', hasCurve: false } as HeadphoneMeasurement;
  const target = { name: 'Some target' } as HeadphoneTarget;

  it('says nothing when everything works', () => {
    expect(whatsOffWords(curve, target, 'defined', true)).toBeNull();
    expect(whatsOffWords(curve, target, 'approximate', true)).toBeNull();
  });

  it('says what to do next in each other case', () => {
    expect(whatsOffWords(null, null, 'unknown', false)).toMatch(/Pick a headphone/);
    expect(whatsOffWords(presetOnly, target, 'unknown', true)).toMatch(/crinacle/);
    expect(whatsOffWords(curve, null, 'unknown', false)).toMatch(/Pick a target/);
    expect(whatsOffWords(curve, target, 'different', true)).toMatch(/other rig/);
    expect(whatsOffWords(curve, target, 'unknown', true)).toMatch(/rig isn't known/);
  });
});

describe('the words', () => {
  it('say predicted and not measured, and whose', () => {
    expect(predictedWords(measurement)).toBe("Predicted, not measured: oratory1990's HD 660 S (GRAS) plus your EQ");
  });

  it('say how the measurement is drawn', () => {
    expect(measuredWords(measurement, false)).toContain('smoothed to 1/12 octave');
    expect(measuredWords(measurement, true)).toContain('raw, as loaded');
  });

  it('say why a target on another rig is hidden', () => {
    expect(targetWords(target, matchOf(measurement, target), true)).toBe(
      'Harman over-ear 2018 is defined on another rig. Not shown against this measurement',
    );
  });

  it('label a family match as approximate, and say so for a translated target', () => {
    const family = { ...target, rig: measurement.rig, isTranslated: true };
    expect(targetWords(family, 'approximate', true)).toContain('approximate');
    expect(targetWords(family, 'approximate', true)).toContain('translated');
  });

  it('never use what the research refuses, in any state', () => {
    const said = [
      predictedWords(measurement),
      measuredWords(measurement, false),
      ...(['defined', 'approximate', 'different', 'unknown'] as const).map((match) => targetWords(target, match, true)),
    ].join(' ');
    expect(said).not.toMatch(/corrected|flat|accurate|your headphones|% match|the right sound/i);
  });
});
