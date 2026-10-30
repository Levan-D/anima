import { describe, expect, it } from 'vitest';
import { formatDuration } from '@/lib/format';

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [999, '0:00'],
    [1_000, '0:01'],
    [59_999, '0:59'],
    [60_000, '1:00'],
    [187_000, '3:07'],
    [3_599_000, '59:59'],
    [3_600_000, '1:00:00'],
    [3_729_000, '1:02:09'],
    [36_000_000, '10:00:00'],
    [360_000_000, '100:00:00'],
    [3_600_000_000_000, '1000000:00:00'],
  ])('%d ms is %s', (milliseconds, expected) => {
    expect(formatDuration(milliseconds)).toBe(expected);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('treats %d as nothing', (milliseconds) => {
    expect(formatDuration(milliseconds)).toBe('0:00');
  });
});
