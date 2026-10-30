import { describe, expect, it } from 'vitest';
import { err, ok } from '@shared/result';

describe('ok', () => {
  it('wraps a value', () => {
    expect(ok(5)).toEqual({ ok: true, value: 5 });
  });

  it('keeps falsy values', () => {
    expect(ok(0)).toEqual({ ok: true, value: 0 });
    expect(ok(null)).toEqual({ ok: true, value: null });
  });

  it('works with no value', () => {
    expect(ok()).toEqual({ ok: true, value: undefined });
  });
});

describe('err', () => {
  it('carries a code and a message', () => {
    expect(err('not_found', 'That track is gone')).toEqual({
      ok: false,
      error: { code: 'not_found', message: 'That track is gone' },
    });
  });
});
