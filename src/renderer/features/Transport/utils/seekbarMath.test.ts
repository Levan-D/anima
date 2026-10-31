import { describe, expect, it } from 'vitest';
import { msUntilChange, seekTarget, timeWords } from '@/features/Transport/utils/seekbarMath';

const press = (key: string, modifiers: { shiftKey?: boolean; altKey?: boolean } = {}) => ({
  key,
  shiftKey: false,
  altKey: false,
  ...modifiers,
});

describe('seekTarget', () => {
  it.each([
    ['ArrowRight', 65_000],
    ['ArrowUp', 65_000],
    ['ArrowLeft', 55_000],
    ['ArrowDown', 55_000],
    ['PageUp', 90_000],
    ['PageDown', 30_000],
    ['Home', 0],
    ['End', 200_000],
  ])('%s goes to %d from a minute in', (key, target) => {
    expect(seekTarget(press(key), 60_000, 200_000)).toBe(target);
  });

  it('Shift takes the bigger step, as Page Up and Page Down do', () => {
    expect(seekTarget(press('ArrowRight', { shiftKey: true }), 60_000, 200_000)).toBe(90_000);
    expect(seekTarget(press('ArrowLeft', { shiftKey: true }), 60_000, 200_000)).toBe(30_000);
  });

  it('stops at both ends', () => {
    expect(seekTarget(press('ArrowLeft'), 2_000, 200_000)).toBe(0);
    expect(seekTarget(press('ArrowRight'), 198_000, 200_000)).toBe(200_000);
  });

  it('leaves other keys alone', () => {
    expect(seekTarget(press('Tab'), 60_000, 200_000)).toBeUndefined();
    expect(seekTarget(press('a'), 60_000, 200_000)).toBeUndefined();
  });

  it('says to do nothing with Alt on an arrow, which means going back, not seeking', () => {
    expect(seekTarget(press('ArrowLeft', { altKey: true }), 60_000, 200_000)).toBeNull();
  });
});

describe('msUntilChange', () => {
  it('has nothing to wait for with nothing playing', () => {
    expect(msUntilChange(0, 0)).toBe(Infinity);
  });

  it('a song of any ordinary length asks for four frames a second, not a hundred', () => {
    expect(msUntilChange(0, 90_000)).toBe(250);
    expect(msUntilChange(0, 240_000)).toBe(250);
  });

  it('a longer one has longer steps of the line to wait for', () => {
    expect(msUntilChange(0, 512_000)).toBeCloseTo(500, 5);
  });

  it('wakes up for the next second, which the clock has to show on time', () => {
    expect(msUntilChange(59_900, 240_000)).toBeCloseTo(100, 5);
  });

  it('a long track only has the clock to keep up with', () => {
    expect(msUntilChange(0, 7_200_000)).toBe(1000);
  });
});

describe('timeWords', () => {
  it('has nothing to say with nothing playing', () => {
    expect(timeWords(0, 0)).toEqual({ elapsed: '', remaining: '', spoken: '' });
  });

  it('gives elapsed and remaining from whole seconds, so they tick together', () => {
    expect(timeWords(0, 187_400)).toMatchObject({ elapsed: '0:00', remaining: '−3:07' });
    expect(timeWords(999, 187_400)).toMatchObject({ elapsed: '0:00', remaining: '−3:07' });
    expect(timeWords(1_000, 187_400)).toMatchObject({ elapsed: '0:01', remaining: '−3:06' });
  });

  it('gets to no time left at the end, and not below', () => {
    expect(timeWords(187_400, 187_400)).toMatchObject({ elapsed: '3:07', remaining: '−0:00' });
    expect(timeWords(190_000, 187_400)).toMatchObject({ remaining: '−0:00' });
  });

  it('counts hours for something long', () => {
    expect(timeWords(3_725_000, 7_200_000).elapsed).toBe('1:02:05');
  });

  it('says it in words for a screen reader', () => {
    expect(timeWords(61_000, 187_400).spoken).toBe('1:01 of 3:07');
  });
});
