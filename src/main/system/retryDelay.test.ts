import { describe, expect, it } from 'vitest';
import { retryDelayMs } from '@main/system/retryDelay';

describe('retryDelayMs', () => {
  it('reads Retry-After as seconds or as a date', () => {
    expect(retryDelayMs(429, '2', 1, 0, 0)).toBe(2_000);
    expect(retryDelayMs(429, 'Thu, 01 Jan 1970 00:00:05 GMT', 1, 1_000, 0)).toBe(4_000);
  });

  it('falls back when Retry-After is missing or nonsense', () => {
    expect(retryDelayMs(429, null, 1, 0, 0)).toBe(5_000);
    expect(retryDelayMs(503, 'soon', 1, 0, 0)).toBe(5_000);
    expect(retryDelayMs(429, ' ', 1, 0, 0)).toBe(5_000);
  });

  it('adds at most 30% jitter', () => {
    expect(retryDelayMs(429, '10', 1, 0, 1)).toBe(13_000);
  });

  it('backs off exponentially for network and server errors', () => {
    expect(retryDelayMs(null, null, 1, 0, 0)).toBe(2_000);
    expect(retryDelayMs(502, null, 3, 0, 0)).toBe(8_000);
  });

  it("doesn't retry other refusals", () => {
    expect(retryDelayMs(400, null, 1, 0, 0)).toBeNull();
    expect(retryDelayMs(401, null, 1, 0, 0)).toBeNull();
  });
});
