import { describe, expect, it } from 'vitest';
import {
  positionAt,
  reported,
  restarted,
  seeked,
  setRunning,
  STOPPED_AT_ZERO,
  type PositionClock,
} from './positionClock';

const running = (positionMs: number, at = 1_000): PositionClock => ({
  positionMs,
  at,
  isRunning: true,
  settlingUntil: 0,
});

describe('positionAt', () => {
  it('moves on with the clock while running, and stays put while not', () => {
    expect(positionAt(running(5_000), 1_250)).toBe(5_250);
    expect(positionAt({ ...running(5_000), isRunning: false }, 1_250)).toBe(5_000);
  });

  it('never goes back for a clock read from before it was set', () => {
    expect(positionAt(running(5_000), 900)).toBe(5_000);
  });
});

describe('a report from main', () => {
  it('sets it outright when nothing is moving', () => {
    expect(positionAt(reported(STOPPED_AT_ZERO, 30_000, 2_000), 2_500)).toBe(30_000);
  });

  it('a little behind what the clock says is jitter, and the numbers keep going forward', () => {
    const next = reported(running(5_000), 5_100, 1_200);
    expect(positionAt(next, 1_200)).toBe(5_200);
  });

  it('a little ahead catches up gently, so the line does not jump', () => {
    const next = reported(running(5_000), 5_300, 1_200);
    const shown = positionAt(next, 1_200);
    expect(shown).toBeGreaterThan(5_200);
    expect(shown).toBeLessThan(5_300);
  });

  it('keeps catching up until it agrees', () => {
    let clock = running(5_000);
    for (let tick = 1; tick <= 20; tick++) clock = reported(clock, 5_100 + tick * 200, 1_000 + tick * 200);
    expect(Math.abs(positionAt(clock, 5_000) - 9_100)).toBeLessThan(2);
  });

  it('far from it means something really happened, and it goes there, either way', () => {
    expect(positionAt(reported(running(5_000), 60_000, 1_200), 1_200)).toBe(60_000);
    expect(positionAt(reported(running(60_000), 0, 1_200), 1_200)).toBe(0);
  });
});

describe('a seek', () => {
  it('moves at once, and goes on from there', () => {
    const clock = seeked(running(5_000), 90_000, 2_000);
    expect(positionAt(clock, 2_000)).toBe(90_000);
    expect(positionAt(clock, 2_100)).toBe(90_100);
  });

  it('ignores a tick that left main before the seek did', () => {
    const clock = seeked(running(5_000), 90_000, 2_000);
    expect(positionAt(reported(clock, 6_000, 2_010), 2_010)).toBe(90_010);
  });

  it('takes the answer when it comes, close to where it went', () => {
    const clock = seeked(running(5_000), 90_000, 2_000);
    expect(positionAt(reported(clock, 90_500, 2_010), 2_010)).toBeGreaterThan(90_010);
  });

  it('stops waiting after a moment, so a seek that went nowhere can come back', () => {
    const clock = seeked(running(5_000), 90_000, 2_000);
    expect(positionAt(reported(clock, 6_000, 2_600), 2_600)).toBe(6_000);
  });
});

describe('starting and stopping', () => {
  it('stopping keeps the place it had got to', () => {
    const clock = setRunning(running(5_000), false, 1_500);
    expect(clock.positionMs).toBe(5_500);
    expect(positionAt(clock, 9_000)).toBe(5_500);
  });

  it('starting goes on from there, not from when it stopped', () => {
    const stopped = setRunning(running(5_000), false, 1_500);
    expect(positionAt(setRunning(stopped, true, 9_000), 9_100)).toBe(5_600);
  });

  it('asking for what it already is changes nothing', () => {
    const clock = running(5_000);
    expect(setRunning(clock, true, 9_000)).toBe(clock);
  });

  it('a restart goes to zero, and forgets a seek it was waiting on', () => {
    const clock = restarted(seeked(running(5_000), 90_000, 2_000), 2_100);
    expect(positionAt(clock, 2_100)).toBe(0);
    expect(positionAt(reported(clock, 5_000, 2_200), 2_200)).toBe(5_000);
  });
});
