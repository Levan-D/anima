import { describe, expect, it } from 'vitest';
import { blockerFor } from './powerKeeper';

const MODES = { pluggedIn: 'screen-on', onBattery: 'keep-running' } as const;

describe('blockerFor', () => {
  it('follows the row for the power source while playing', () => {
    expect(blockerFor(MODES, false, true)).toBe('prevent-display-sleep');
    expect(blockerFor(MODES, true, true)).toBe('prevent-app-suspension');
  });

  it('holds nothing when off or when not playing', () => {
    expect(blockerFor({ ...MODES, pluggedIn: 'off' }, false, true)).toBeNull();
    expect(blockerFor(MODES, false, false)).toBeNull();
    expect(blockerFor(MODES, true, false)).toBeNull();
  });
});
