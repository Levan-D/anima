import { describe, expect, it } from 'vitest';
import { initialBounds, miniPlayerBounds, miniQueueBounds, stripWithin } from '@main/system/windowBounds';

const laptop = { x: 0, y: 0, width: 1280, height: 752 };
const tv = { x: 1280, y: 0, width: 3840, height: 2160 };
const small = { x: 0, y: 0, width: 1000, height: 700 };

const saved = (bounds: Partial<{ x: number; y: number; width: number; height: number }>) => ({
  x: 100,
  y: 100,
  width: 800,
  height: 600,
  isMaximized: false,
  ...bounds,
});

describe('miniPlayerBounds', () => {
  const size = { width: 440, height: 80 };

  it('starts in the corner of the primary display', () => {
    expect(miniPlayerBounds(null, size, [tv], tv)).toEqual({ x: 1280 + 3840 - 464, y: 2160 - 104, ...size });
  });

  it('goes back where it was left, even though it is shorter than the usual margin', () => {
    expect(miniPlayerBounds({ x: 200, y: 300 }, size, [laptop], laptop)).toEqual({ x: 200, y: 300, ...size });
  });

  it('comes back from a display that has gone', () => {
    expect(miniPlayerBounds({ x: 3000, y: 300 }, size, [laptop], laptop)).toEqual({ x: 816, y: 648, ...size });
  });

  it('stays whole on the display when it was left at the edge at a narrower width', () => {
    expect(miniPlayerBounds({ x: 1000, y: 300 }, size, [laptop], laptop)).toEqual({ x: 840, y: 300, ...size });
  });
});

describe('miniQueueBounds', () => {
  const strip = { x: 200, y: 100, width: 620, height: 80 };

  it('grows downward when there is room', () => {
    expect(miniQueueBounds(strip, 420, laptop)).toEqual({
      side: 'below',
      bounds: { ...strip, height: 500 },
    });
  });

  it('grows upward near the bottom of the screen, leaving the strip where it is', () => {
    const low = { ...strip, y: 600 };
    const { side, bounds } = miniQueueBounds(low, 420, laptop);
    expect(side).toBe('above');
    expect(bounds).toEqual({ ...low, y: 180, height: 500 });
    expect(stripWithin(bounds, low, side)).toEqual(low);
  });

  it('never leaves the work area, taking the roomier side when neither fits', () => {
    const short = { x: 0, y: 40, width: 1280, height: 300 };
    const { side, bounds } = miniQueueBounds({ ...strip, y: 120 }, 420, short);
    expect(side).toBe('below');
    expect(bounds.y + bounds.height).toBe(340);
  });
});

describe('stripWithin', () => {
  const strip = { x: 200, y: 100, width: 620, height: 80 };

  it('follows a drag of the grown window', () => {
    const moved = { x: 300, y: 50, width: 620, height: 500 };
    expect(stripWithin(moved, strip, 'below')).toEqual({ ...strip, x: 300, y: 50 });
    expect(stripWithin(moved, strip, 'above')).toEqual({ ...strip, x: 300, y: 470 });
  });
});

describe('initialBounds', () => {
  it('uses the default size on a first launch, letting the OS center it', () => {
    expect(initialBounds(null, [tv], tv)).toEqual({ width: 1440, height: 900 });
  });

  it('never opens bigger than the screen', () => {
    expect(initialBounds(null, [laptop], laptop)).toEqual({ width: 1280, height: 752 });
  });

  it('restores saved bounds on a display that is still there', () => {
    expect(initialBounds(saved({}), [laptop, tv], laptop)).toEqual({ x: 100, y: 100, width: 800, height: 600 });
    expect(initialBounds(saved({ x: 2000 }), [laptop, tv], laptop)).toMatchObject({ x: 2000 });
  });

  it('forgets bounds from a display that has gone', () => {
    expect(initialBounds(saved({ x: 2000 }), [laptop], laptop)).toEqual({ width: 1280, height: 752 });
  });

  it('forgets bounds with almost nothing left on screen', () => {
    expect(initialBounds(saved({ x: 1250 }), [laptop], laptop)).toEqual({ width: 1280, height: 752 });
  });

  it('shrinks a window saved on a bigger screen to fit', () => {
    const fromTheTv = saved({ x: 0, y: 0, width: 3840, height: 2160 });
    expect(initialBounds(fromTheTv, [small], small)).toEqual({ x: 0, y: 0, width: 1000, height: 700 });
  });

  it('forgets a window that straddled a display that has gone, if shrinking would leave it off screen', () => {
    const straddling = saved({ x: -3000, y: 100, width: 3500, height: 700 });
    expect(initialBounds(straddling, [laptop], laptop)).toEqual({ width: 1280, height: 752 });
  });

  it('keeps a window that shrinks and still reaches the display', () => {
    const wide = saved({ x: -500, y: 100, width: 3500, height: 700 });
    expect(initialBounds(wide, [laptop], laptop)).toEqual({ x: -500, y: 100, width: 1280, height: 700 });
  });
});
