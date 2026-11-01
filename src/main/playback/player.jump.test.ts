/* The order of things around a jump chosen by hand, on a stand-in mpv. What actually comes out is in player.jump.bytes.test.ts. */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeHarness, type PlayerHarness } from './testFixtures';

const TIMES = { outMs: 4, flushMs: 2, holdMs: 2, inMs: 2 };
const GIVE_UP_MS = 3_000;
const passes = async (harness: PlayerHarness, ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
  await harness.settle();
};
const volumes = (harness: PlayerHarness) =>
  harness
    .mpv()
    .sent('set_property')
    .filter(([, name]) => name === 'volume')
    .map(([, , value]) => value as number);

async function playing(settings = {}) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const harness = makeHarness({ settings, deps: { jumpFade: TIMES } });
  harness.player.start();
  harness.player.play([1, 2, 3], 0);
  await harness.settle();
  harness.mpv().startCurrent();
  harness.mpv().playbackRestart();
  await harness.settle();
  return harness;
}

describe('a jump chosen by hand', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is silent before mpv is told to move, and comes back only after the new file has started', async () => {
    const harness = await playing({ volume: 80 });
    const { player, mpv } = harness;
    const before = volumes(harness).length;

    player.next();
    await harness.settle();
    expect(mpv().sent('playlist-next')).toHaveLength(0);

    await passes(harness, 20);
    expect(mpv().sent('playlist-next')).toHaveLength(1);
    expect(volumes(harness).at(-1)).toBe(0);
    const falling = volumes(harness).slice(before);
    expect(falling.length).toBeGreaterThan(2);
    expect([...falling].sort((a, b) => b - a)).toEqual(falling);

    await passes(harness, 100);
    expect(volumes(harness).at(-1)).toBe(0);

    mpv().startCurrent();
    mpv().playbackRestart();
    await passes(harness, 1);
    expect(volumes(harness).at(-1)).toBe(0);
    await passes(harness, 20);
    expect(volumes(harness).at(-1)).toBe(80);
  });

  it('leaves the volume alone when a track runs into the next', async () => {
    const harness = await playing();
    const before = volumes(harness).length;
    harness.mpv().finishCurrent();
    harness.mpv().playbackRestart();
    await passes(harness, 100);
    expect(volumes(harness)).toHaveLength(before);
    expect(harness.mpv().sent('playlist-next')).toHaveLength(0);
  });

  it('moves only once for a run of presses, to where they ended up', async () => {
    const harness = await playing();
    harness.player.next();
    harness.player.next();
    await passes(harness, 20);
    expect(harness.mpv().sent('playlist-next')).toHaveLength(0);
    expect(
      harness
        .mpv()
        .sent('loadfile')
        .filter(([, , mode]) => mode === 'replace'),
    ).toHaveLength(2);
    expect(harness.player.state().queueIndex).toBe(2);
  });

  it('holds a seek until the old audio has gone, and comes back after it', async () => {
    const harness = await playing();
    harness.mpv().timePos(5);
    harness.player.seek(60_000);
    await harness.settle();
    expect(harness.mpv().sent('seek')).toHaveLength(0);
    await passes(harness, 20);
    expect(harness.mpv().sent('seek')).toHaveLength(1);
    expect(volumes(harness).at(-1)).toBe(0);
    harness.mpv().playbackRestart();
    await passes(harness, 20);
    expect(volumes(harness).at(-1)).toBe(100);
  });

  it('goes silent ahead of the unpause when a jump is made while paused', async () => {
    const harness = await playing();
    harness.player.pause();
    await harness.settle();
    const seen = harness.mpv().commands.length;
    harness.player.playQueueIndex(2);
    const after = harness.mpv().commands.slice(seen);
    const silentAt = after.findIndex(([, name, value]) => name === 'volume' && value === 0);
    const unpausedAt = after.findIndex(([, name, value]) => name === 'pause' && value === false);
    expect(silentAt).toBeGreaterThanOrEqual(0);
    expect(silentAt).toBeLessThan(unpausedAt);
  });

  it('never stays silent when nothing new comes', async () => {
    const harness = await playing({ volume: 70 });
    harness.player.next();
    await passes(harness, 20);
    expect(volumes(harness).at(-1)).toBe(0);
    await passes(harness, GIVE_UP_MS);
    expect(volumes(harness).at(-1)).toBe(70);
  });

  it('comes back when the queue runs out on a press, with nothing left to start', async () => {
    const harness = await playing({ volume: 70 });
    harness.player.playQueueIndex(2);
    await passes(harness, 20);
    harness.mpv().startCurrent();
    harness.mpv().playbackRestart();
    await passes(harness, 20);
    harness.player.next();
    await passes(harness, 20);
    expect(harness.player.state().status).toBe('ended');
    harness.mpv().property('idle-active', true);
    await passes(harness, 5);
    expect(volumes(harness).at(-1)).toBe(70);
  });

  it('takes a volume moved during a fade from then on, and lands on it', async () => {
    const harness = await playing({ volume: 80 });
    harness.player.next();
    harness.player.setVolume(50);
    await passes(harness, 20);
    harness.mpv().startCurrent();
    harness.mpv().playbackRestart();
    await passes(harness, 20);
    expect(volumes(harness).at(-1)).toBe(50);
    expect(harness.settings.get().volume).toBe(50);
  });
});
