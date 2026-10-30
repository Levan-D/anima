import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatCount,
  formatDateTime,
  formatDuration,
  formatPlural,
  formatSpan,
  joinParts,
} from '@/lib/format';

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

describe('formatSpan', () => {
  it.each([
    [0, '0 s'],
    [45_000, '45 s'],
    [60_000, '1 min'],
    [125_000, '2 min 5 s'],
    [3_600_000, '1 hr'],
    [3_720_000, '1 hr 2 min'],
    [Number.NaN, '0 s'],
  ])('%d ms is %s', (milliseconds, expected) => {
    expect(formatSpan(milliseconds)).toBe(expected);
  });
});

describe('formatPlural and formatCount', () => {
  it('uses the singular only for one, and groups thousands', () => {
    expect(formatPlural(1, 'track')).toBe('1 track');
    expect(formatPlural(0, 'track')).toBe('0 tracks');
    expect(formatPlural(1_204, 'track')).toBe('1,204 tracks');
    expect(formatPlural(2, 'more file', 'more files')).toBe('2 more files');
    expect(formatCount(5_719)).toBe('5,719');
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1_536, '1.5 KB'],
    [4_718_592, '4.5 MB'],
    [454_000_000, '433 MB'],
    [161_000_000_000, '150 GB'],
    [Number.NaN, '0 B'],
  ])('%d bytes is %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe('formatDateTime', () => {
  it('gives a date and a time', () => {
    const text = formatDateTime(new Date(2026, 9, 30, 18, 2).getTime());
    expect(text).toContain('Oct 30, 2026');
    expect(text).toContain('6:02');
  });
});

describe('joinParts', () => {
  it('leaves out what is not there', () => {
    expect(joinParts('Björk', 1997)).toBe('Björk · 1997');
    expect(joinParts('Björk', null)).toBe('Björk');
    expect(joinParts(null, null)).toBe('');
    expect(joinParts('', 'Homogenic')).toBe('Homogenic');
  });
});
