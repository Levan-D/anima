import { describe, expect, it } from 'vitest';
import { wordAtHz } from '@/features/Equalizer/utils/chartData';
import { track } from '@/lib/testing';
import {
  bandNumbers,
  curvePath,
  curveRateOf,
  DEFAULT_BANDS,
  dragGain,
  gainForNode,
  gainOfY,
  gainWords,
  hzOfX,
  hzWords,
  newBand,
  nodeDb,
  roundHz,
  stepGain,
  stepHz,
  stepQ,
  typedGain,
  typedHz,
  xOfHz,
  yOfGain,
} from '@/features/Equalizer/utils/eqBands';

describe('the rate the curve is drawn at', () => {
  const signal = (sampleRate: number | null) => ({
    decoded: sampleRate === null ? null : { sampleRate, format: 's16', channels: 2 },
    output: null,
    isBitPerfect: false,
    kind: null,
    alterations: [],
  });

  it('is what mpv decoded, or what the library says of a track not open yet, or 44.1 kHz with nothing to go on', () => {
    expect(curveRateOf({ signal: signal(96_000), current: null })).toBe(96_000);
    expect(curveRateOf({ signal: signal(null), current: track({ sampleRate: 48_000 }) })).toBe(48_000);
    expect(curveRateOf({ signal: signal(null), current: track({ sampleRate: null }) })).toBe(44_100);
    expect(curveRateOf({ signal: signal(null), current: null })).toBe(44_100);
  });

  it('changes the curve near the top, as the real filter does', () => {
    const bands = [{ id: 1, kind: 'peak' as const, frequencyHz: 16_000, gainDb: 6, q: 1 }];
    expect(curvePath(bands, 44_100)).not.toBe(curvePath(bands, 96_000));
  });
});

describe('the plot', () => {
  it('runs from 20 Hz to 20 kHz on a log scale, with 632 Hz in the middle', () => {
    expect(xOfHz(20)).toBeCloseTo(0);
    expect(xOfHz(20_000)).toBeCloseTo(1);
    expect(hzOfX(0.5)).toBeCloseTo(632.46, 1);
    expect(hzOfX(xOfHz(1234))).toBeCloseTo(1234);
  });

  it('holds a pointer that goes past the edges', () => {
    expect(hzOfX(-1)).toBe(20);
    expect(hzOfX(2)).toBeCloseTo(20_000);
    expect(gainOfY(-1)).toBe(12);
    expect(gainOfY(2)).toBe(-12);
  });

  it('has 0 dB in the middle and boosts going up', () => {
    expect(yOfGain(0)).toBe(0.5);
    expect(yOfGain(12)).toBe(0);
    expect(gainOfY(yOfGain(-7.5))).toBeCloseTo(-7.5);
  });

  it('draws flat bands as a straight line through the middle', () => {
    expect(
      curvePath(DEFAULT_BANDS, 44_100)
        .split('L')
        .every((point) => point.endsWith(' 500.0')),
    ).toBe(true);
  });
});

describe('steps', () => {
  it('rounds frequencies to what can be read', () => {
    expect(roundHz(1234.5)).toBe(1230);
    expect(roundHz(234.5)).toBe(235);
    expect(roundHz(23.456)).toBeCloseTo(23.5);
    expect(roundHz(5)).toBe(20);
  });

  it('stops at the ends of each range', () => {
    expect(stepHz(19_500, 1)).toBe(20_000);
    expect(stepGain(11.5, 3)).toBe(12);
    expect(stepQ(9, 1)).toBe(10);
    expect(stepQ(0.11, -1)).toBe(0.1);
  });

  it('lands a drag on exactly flat from close by', () => {
    expect(dragGain(0.2)).toBe(0);
    expect(dragGain(-0.29)).toBe(0);
    expect(dragGain(0.34)).toBe(0.3);
  });
});

describe('words', () => {
  it('reads the way the numbers are said', () => {
    expect(hzWords(80)).toBe('80 Hz');
    expect(hzWords(1000)).toBe('1 kHz');
    expect(hzWords(12_500)).toBe('12.5 kHz');
    expect(gainWords(0)).toBe('0 dB');
    expect(gainWords(3)).toBe('+3.0 dB');
    expect(gainWords(-2.5)).toBe('−2.5 dB');
  });
});

describe('bands', () => {
  it('starts with five flat bands', () => {
    expect(DEFAULT_BANDS).toHaveLength(5);
    expect(DEFAULT_BANDS.every(({ gainDb }) => gainDb === 0)).toBe(true);
  });

  it('adds a flat peak in the widest gap, with an id of its own', () => {
    const added = newBand(DEFAULT_BANDS);
    expect(added).toMatchObject({ id: 6, kind: 'peak', gainDb: 0 });
    expect(added.frequencyHz).toBeGreaterThan(20);
    expect(DEFAULT_BANDS.some(({ frequencyHz }) => frequencyHz === added.frequencyHz)).toBe(false);
  });

  it('adds one in the middle when there are none', () => {
    expect(newBand([]).frequencyHz).toBeCloseTo(632, 0);
  });
});

describe('a node on the curve', () => {
  const shelf = { id: 1, kind: 'lowshelf', frequencyHz: 100, gainDb: 12, q: 0.707 } as const;
  const peak = { id: 2, kind: 'peak', frequencyHz: 1000, gainDb: 6, q: 1 } as const;

  it('draws a shelf at half its gain, at its own frequency', () => {
    expect(nodeDb([shelf], shelf, 44_100)).toBeCloseTo(6);
  });

  it('gives the gain that keeps it under the pointer, whatever else is there', () => {
    const gain = gainForNode([shelf, peak], shelf, 100, 3, 44_100);
    expect(nodeDb([{ ...shelf, gainDb: gain }, peak], shelf, 44_100)).toBeCloseTo(3, 1);
  });
});

describe('numbering and naming', () => {
  const at = (id: number, frequencyHz: number) => ({ id, kind: 'peak', frequencyHz, gainDb: 0, q: 1 }) as const;

  it('numbers left to right, whatever the order they were made in', () => {
    const numbers = bandNumbers([at(1, 4000), at(2, 100), at(3, 100), at(4, 1000)]);
    expect([numbers.get(2), numbers.get(3), numbers.get(4), numbers.get(1)]).toEqual([1, 2, 3, 4]);
  });

  it('calls a frequency by its tightest word, or its zone in a gap between words', () => {
    expect(wordAtHz(300)).toBe('Fullness');
    expect(wordAtHz(5000)).toBe('Edge');
    expect(wordAtHz(460)).toBe('Midrange');
  });
});

describe('typed values', () => {
  it('reads kHz, and the minus sign the field shows', () => {
    expect(typedHz('1.5 kHz')).toBe(1500);
    expect(typedGain('−3.0 dB')).toBe(-3);
  });

  it('drops what is not a number', () => {
    expect(typedHz('loud')).toBeNull();
  });
});
