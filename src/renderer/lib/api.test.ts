import { describe, expect, it } from 'vitest';
import { AppFailure, unwrap } from '@/lib/api';
import { err, ok } from '@shared/result';

describe('unwrap', () => {
  it('returns the value of a success', () => {
    expect(unwrap(ok(5))).toBe(5);
  });

  it('throws an AppFailure with the code and message of a failure', () => {
    const run = () => unwrap(err('not_found', 'That album is gone'));

    expect(run).toThrow(AppFailure);
    expect(run).toThrow('That album is gone');
    try {
      run();
    } catch (error) {
      expect((error as AppFailure).code).toBe('not_found');
    }
  });
});
