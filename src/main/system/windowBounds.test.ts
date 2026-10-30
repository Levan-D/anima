import { describe, expect, it } from 'vitest';
import { initialBounds } from '@main/system/windowBounds';

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
