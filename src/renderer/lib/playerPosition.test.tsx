import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerPosition } from '@shared/domain';
import {
  currentPosition,
  PAINT_EVERY_MS,
  showSeek,
  startPlayerPositionSync,
  usePlayerPosition,
} from '@/lib/playerPosition';
import { setPlayerState } from '@/lib/playerStore';
import { playerStateWith, resetRendererState, stubApi, track, type StubbedApi } from '@/lib/testing';
import { startWindowVisibilitySync } from '@/lib/windowVisibility';

const SONG = track({ id: 1, durationMs: 200_000 });
const OTHER = track({ id: 2, durationMs: 100_000 });

const playing = (overrides = {}) =>
  playerStateWith({ status: 'playing', current: SONG, queueIndex: 0, durationMs: 200_000, loadId: 1, ...overrides });

let api: StubbedApi;
let mainSays: PlayerPosition;

const nextFrames = (count: number) => {
  for (let frame = 0; frame < count; frame++) vi.advanceTimersToNextFrame();
};

/** Runs what's due right now, and moves the clock no further than that. */
const nextFramesWithoutTime = () => vi.advanceTimersByTime(0);

/** Lets replies from the stubbed main arrive. */
const settle = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

function watch() {
  const painter = vi.fn<(positionMs: number, durationMs: number) => void>();
  const view = renderHook(() => usePlayerPosition(painter));
  return { painter, lastPosition: () => painter.mock.lastCall?.[0], ...view };
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'],
  });
  resetRendererState();
  mainSays = { loadId: 1, positionMs: 0 };
  api = stubApi({
    'player.position': () => mainSays,
    'window.state': { isFullscreen: false, isMiniPlayer: false, isHidden: false },
  });
  startPlayerPositionSync();
  startWindowVisibilitySync();
});

afterEach(() => {
  api.emit('window.state', { isFullscreen: false, isMiniPlayer: false, isHidden: false });
  resetRendererState();
  vi.useRealTimers();
});

describe('the position', () => {
  it('paints what it knows as soon as something listens, and never through React', async () => {
    setPlayerState(playing({ status: 'paused' }));
    await settle();
    api.emit('player.position', { loadId: 1, positionMs: 30_000 });

    const { painter } = watch();

    expect(painter).toHaveBeenCalledWith(30_000, 200_000);
  });

  it('moves between the reports while it plays', async () => {
    setPlayerState(playing());
    await settle();
    const { lastPosition } = watch();
    const start = lastPosition() ?? 0;

    nextFrames(60);

    expect((lastPosition() ?? 0) - start).toBeGreaterThan(900);
    expect((lastPosition() ?? 0) - start).toBeLessThan(1_100);
  });

  it('asks for no frames at all while paused', async () => {
    setPlayerState(playing());
    await settle();
    const { painter } = watch();
    setPlayerState(playing({ status: 'paused' }));
    painter.mockClear();

    nextFrames(30);

    expect(painter).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops when the window is hidden, and paints where it has got to when it comes back', async () => {
    setPlayerState(playing());
    await settle();
    const { painter, lastPosition } = watch();
    nextFrames(5);
    const before = lastPosition() ?? 0;

    api.emit('window.state', { isFullscreen: false, isMiniPlayer: false, isHidden: true });
    painter.mockClear();
    expect(vi.getTimerCount()).toBe(0);

    // Not even a report from main paints, and time goes on regardless.
    api.emit('player.position', { loadId: 1, positionMs: 5_000 });
    vi.advanceTimersByTime(5_000);
    expect(painter).not.toHaveBeenCalled();

    api.emit('window.state', { isFullscreen: false, isMiniPlayer: false, isHidden: false });
    expect(lastPosition()).toBeGreaterThan(before + 5_000);
    expect(vi.getTimerCount()).toBe(1);
  });

  describe('how often it wakes up', () => {
    it('sleeps for as long as the painter says it has nothing new, then asks for a frame', async () => {
      setPlayerState(playing());
      await settle();
      const painter = vi.fn(() => 500);
      renderHook(() => usePlayerPosition(painter));
      painter.mockClear();

      vi.advanceTimersByTime(499);
      nextFramesWithoutTime();
      expect(painter).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      vi.advanceTimersToNextFrame();
      expect(painter).toHaveBeenCalledOnce();
    });

    it('wakes for whoever needs it soonest', async () => {
      setPlayerState(playing());
      await settle();
      renderHook(() => usePlayerPosition(() => 1_000));
      const soon = vi.fn(() => 100);
      renderHook(() => usePlayerPosition(soon));
      soon.mockClear();

      vi.advanceTimersByTime(100);
      vi.advanceTimersToNextFrame();

      expect(soon).toHaveBeenCalledOnce();
    });

    it('paints everyone in the same frame, so several of them cost one', async () => {
      setPlayerState(playing());
      await settle();
      const unhurried = vi.fn(() => 1_000);
      const hurried = vi.fn(() => PAINT_EVERY_MS);
      renderHook(() => usePlayerPosition(unhurried));
      renderHook(() => usePlayerPosition(hurried));
      unhurried.mockClear();
      hurried.mockClear();

      vi.advanceTimersByTime(PAINT_EVERY_MS);
      vi.advanceTimersToNextFrame();

      expect(hurried).toHaveBeenCalledOnce();
      expect(unhurried).toHaveBeenCalledOnce();
    });

    it('a jump paints at once, without waiting for the sleep to end', async () => {
      setPlayerState(playing());
      await settle();
      const painter = vi.fn((_positionMs: number, _durationMs: number) => 5_000);
      renderHook(() => usePlayerPosition(painter));

      api.emit('player.position', { loadId: 1, positionMs: 90_000 });

      expect(painter.mock.lastCall?.[0]).toBe(90_000);
    });

    it('a report that only agrees wakes nothing up', async () => {
      setPlayerState(playing());
      await settle();
      const painter = vi.fn(() => 5_000);
      renderHook(() => usePlayerPosition(painter));
      painter.mockClear();

      vi.advanceTimersByTime(200);
      api.emit('player.position', { loadId: 1, positionMs: 200 });

      expect(painter).not.toHaveBeenCalled();
    });

    it('a seek paints at once, and the sleep starts again from there', async () => {
      setPlayerState(playing());
      await settle();
      const painter = vi.fn((_positionMs: number, _durationMs: number) => 500);
      renderHook(() => usePlayerPosition(painter));
      vi.advanceTimersByTime(400);
      painter.mockClear();

      showSeek(10_000);
      expect(painter).toHaveBeenCalledOnce();
      painter.mockClear();

      vi.advanceTimersByTime(499);
      nextFramesWithoutTime();
      expect(painter).not.toHaveBeenCalled();
    });

    it('a painter with nothing to wait for has a frame every frame', async () => {
      setPlayerState(playing());
      await settle();
      const { painter } = watch();
      painter.mockClear();

      nextFrames(10);

      expect(painter).toHaveBeenCalledTimes(10);
    });

    it('stopping cancels a sleep as well as a frame', async () => {
      setPlayerState(playing());
      await settle();
      renderHook(() => usePlayerPosition(() => 5_000));
      expect(vi.getTimerCount()).toBe(1);

      setPlayerState(playing({ status: 'paused' }));

      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it('asks for no frames when nothing is listening', async () => {
    setPlayerState(playing());
    await settle();
    expect(vi.getTimerCount()).toBe(0);

    const { unmount } = watch();
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('drops a report from a load that has been replaced', async () => {
    setPlayerState(playing({ status: 'paused', loadId: 5 }));
    mainSays = { loadId: 5, positionMs: 0 };
    await settle();
    const { lastPosition } = watch();

    api.emit('player.position', { loadId: 4, positionMs: 123_000 });

    expect(lastPosition()).toBe(0);
  });

  it('goes back to zero for a different track, before main has even said', async () => {
    setPlayerState(playing({ status: 'paused' }));
    await settle();
    api.emit('player.position', { loadId: 1, positionMs: 90_000 });
    const { lastPosition } = watch();
    expect(lastPosition()).toBe(90_000);

    mainSays = { loadId: 2, positionMs: 0 };
    setPlayerState(playing({ status: 'loading', loadId: 2, current: OTHER, queueIndex: 1, durationMs: 100_000 }));

    expect(lastPosition()).toBe(0);
  });

  it('holds its place through a reload of the same track, then takes what main says', async () => {
    setPlayerState(playing());
    await settle();
    api.emit('player.position', { loadId: 1, positionMs: 90_000 });
    const { lastPosition } = watch();

    mainSays = { loadId: 2, positionMs: 90_400 };
    setPlayerState(playing({ status: 'loading', loadId: 2 }));
    expect(lastPosition()).toBe(90_000);

    await settle();
    expect(lastPosition()).toBe(90_400);
  });

  it('a seek moves right away, and a tick from before it can not undo that', async () => {
    setPlayerState(playing());
    await settle();
    const { lastPosition } = watch();

    showSeek(120_000);
    expect(lastPosition()).toBe(120_000);

    api.emit('player.position', { loadId: 1, positionMs: 2_000 });
    expect(lastPosition()).toBe(120_000);

    api.emit('player.position', { loadId: 1, positionMs: 120_000 });
    expect(lastPosition()).toBe(120_000);
  });

  it('never paints past the end of the track', async () => {
    setPlayerState(playing({ durationMs: 200_000 }));
    await settle();
    api.emit('player.position', { loadId: 1, positionMs: 199_990 });
    const { lastPosition } = watch();

    nextFrames(30);

    expect(lastPosition()).toBe(200_000);
  });

  it('a queue that has ended shows the whole track, since the reports stop a moment short', async () => {
    setPlayerState(playing({ status: 'paused' }));
    await settle();
    api.emit('player.position', { loadId: 1, positionMs: 199_700 });
    const { lastPosition } = watch();

    setPlayerState(playing({ status: 'ended' }));

    expect(lastPosition()).toBe(200_000);
    expect(currentPosition()).toBe(200_000);
  });

  it('with nothing playing it is at zero, whatever it was', async () => {
    setPlayerState(playing({ status: 'paused' }));
    await settle();
    api.emit('player.position', { loadId: 1, positionMs: 60_000 });
    const { lastPosition } = watch();

    setPlayerState(playerStateWith({ loadId: 2 }));

    expect(lastPosition()).toBe(0);
  });
});
