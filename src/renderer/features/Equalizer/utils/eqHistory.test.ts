import { describe, expect, it } from 'vitest';
import { EQ_AUTO_PREAMP, type EqSettings } from '@shared/domain';
import { EMPTY_HISTORY, endGroup, record, redo, undo } from '@/features/Equalizer/utils/eqHistory';

const eq = (gainDb: number): EqSettings => ({
  enabled: true,
  bands: [{ id: 1, kind: 'peak', frequencyHz: 1000, gainDb, q: 1 }],
  preamp: EQ_AUTO_PREAMP,
});

describe('the EQ history', () => {
  it('walks back and forth, and a new change drops what was ahead', () => {
    let history = record(EMPTY_HISTORY, eq(0), null);
    history = record(history, eq(1), null);
    const back = undo(history, eq(2));
    expect(back?.eq).toEqual(eq(1));
    const forward = back && redo(back.history, back.eq);
    expect(forward?.eq).toEqual(eq(2));
    expect(back && record(back.history, eq(1), null).future).toEqual([]);
  });

  it('takes one drag as one step, until the group ends', () => {
    let history = record(EMPTY_HISTORY, eq(0), 'drag');
    history = record(history, eq(1), 'drag');
    expect(history.past).toEqual([eq(0)]);
    history = record(endGroup(history), eq(2), 'drag');
    expect(history.past).toEqual([eq(0), eq(2)]);
  });

  it('has nothing to do at either end', () => {
    expect(undo(EMPTY_HISTORY, eq(0))).toBeNull();
    expect(redo(EMPTY_HISTORY, eq(0))).toBeNull();
  });
});
