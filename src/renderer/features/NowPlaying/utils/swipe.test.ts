import { describe, expect, it } from 'vitest';
import { swipeAction } from '@/features/NowPlaying/utils/swipe';

const WIDTH = 1000;

describe('swipeAction', () => {
  it('left is next and right is previous, past the threshold', () => {
    expect(swipeAction(-300, 10, WIDTH)).toBe('next');
    expect(swipeAction(300, -10, WIDTH)).toBe('previous');
  });

  it('a short move is nothing', () => {
    expect(swipeAction(-150, 0, WIDTH)).toBeNull();
    expect(swipeAction(0, 0, WIDTH)).toBeNull();
  });

  it('a mostly vertical move is nothing, however long', () => {
    expect(swipeAction(-300, 400, WIDTH)).toBeNull();
    expect(swipeAction(300, 250, WIDTH)).toBeNull();
  });
});
