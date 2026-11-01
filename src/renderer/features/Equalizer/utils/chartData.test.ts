import { describe, expect, it } from 'vitest';
import { INSTRUMENT_FAMILIES, type Instrument } from '@/features/Equalizer/utils/chartData';

const SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NOTE = /([A-G])([♭♯]?)(\d)/;

/** From A4 = 440 Hz, in equal temperament. C4 is middle C. */
function hzOf(note: string): number {
  const [, letter, accidental, octave] = NOTE.exec(note) ?? [];
  const shift = accidental === '♭' ? -1 : accidental === '♯' ? 1 : 0;
  const midi = (SEMITONES[letter ?? ''] ?? 0) + shift + (Number(octave) + 1) * 12;
  return 440 * 2 ** ((midi - 69) / 12);
}

// These have no pitch to speak of, and stay as read off IRN's chart.
const UNPITCHED = ['Kick', 'Toms', 'Snare', 'Congas', 'Cymbals'];
const instruments: Instrument[] = INSTRUMENT_FAMILIES.flatMap((family) => [...family.instruments]);
const pitched = instruments.filter(({ name }) => !UNPITCHED.includes(name));
const RANGE = /^([A-G][♭♯]?\d)(?:, below this plot,)? to ([A-G][♭♯]?\d)/;

describe('the chart’s pitches', () => {
  it('knows its pitches: A4, middle C, and the piano’s ends', () => {
    expect(hzOf('A4')).toBe(440);
    expect(hzOf('C4')).toBeCloseTo(261.63, 2);
    expect(hzOf('A0')).toBeCloseTo(27.5, 2);
    expect(hzOf('C8')).toBeCloseTo(4186.01, 2);
    expect(hzOf('B♭0')).toBeCloseTo(29.14, 2);
  });

  it.each(pitched.map((instrument) => [instrument.name, instrument] as const))(
    '%s says the same in its numbers and its note',
    (_name, { fundamentals, note }) => {
      const [, low, high] = RANGE.exec(note) ?? [];
      expect(low, note).toBeDefined();
      expect(fundamentals[0]).toBeCloseTo(hzOf(low ?? ''), 0);
      expect(fundamentals[1]).toBeCloseTo(hzOf(high ?? ''), 0);
    },
  );

  it.each(instruments.map((instrument) => [instrument.name, instrument] as const))(
    '%s has its bars in order, each running on from the last',
    (_name, { fundamentals, harmonics, fringe }) => {
      expect(fundamentals[0]).toBeLessThan(fundamentals[1]);
      if (harmonics !== null) {
        expect(harmonics[0]).toBeCloseTo(fundamentals[1], 5);
        expect(harmonics[0]).toBeLessThan(harmonics[1]);
      }
      for (const [low, high] of fringe) expect(low).toBeLessThan(high);
    },
  );

  it('names a lower fringe’s bottom in the note, where it has one', () => {
    for (const { name, fundamentals, fringe, note } of pitched) {
      for (const [low, high] of fringe) {
        if (high > fundamentals[0]) continue;
        const named = [...note.matchAll(new RegExp(NOTE, 'g'))].map(([text]) => hzOf(text));
        expect(
          named.some((hz) => Math.abs(hz - low) < 0.5),
          name,
        ).toBe(true);
      }
    }
  });
});
