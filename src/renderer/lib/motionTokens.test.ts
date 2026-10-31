import { afterEach, describe, expect, it } from 'vitest';
import { motionDuration } from '@/lib/motionTokens';

const { style } = document.documentElement;

afterEach(() => {
  style.removeProperty('--dur-mid');
});

describe('motionDuration', () => {
  it.each([
    ['300ms', 0.3],
    ['.3s', 0.3],
    ['0.3s', 0.3],
    ['0ms', 0],
    ['0s', 0],
  ])('reads %s, whichever way the build wrote it', (written, seconds) => {
    style.setProperty('--dur-mid', written);
    expect(motionDuration('--dur-mid')).toBeCloseTo(seconds, 5);
  });

  it('reads the loop as well', () => {
    style.setProperty('--dur-loop', '1800ms');
    expect(motionDuration('--dur-loop')).toBeCloseTo(1.8, 5);
    style.removeProperty('--dur-loop');
  });

  it('is instant when the token is not there', () => {
    expect(motionDuration('--dur-mid')).toBe(0);
  });
});
