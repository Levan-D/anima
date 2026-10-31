import { describe, expect, it } from 'vitest';
import { createListenLog } from '@main/stats/listenLog';

function setup() {
  const plays: { trackId: number; listenedMs: number }[] = [];
  const saved: [number, number][] = [];
  const log = createListenLog({
    recordPlay(trackId, listenedMs) {
      plays.push({ trackId, listenedMs });
      return plays.length;
    },
    saveListened: (eventId, listenedMs) => saved.push([eventId, listenedMs]),
  });

  function play(listen: number, durationMs: number, fromMs: number, toMs: number, trackId = 1): void {
    for (let positionMs = fromMs; positionMs <= toMs; positionMs += 200) {
      log.position({ listen, trackId, durationMs, positionMs });
    }
  }
  return { log, plays, saved, play };
}

describe('the listen log', () => {
  it('records a long track once, at 30 s', () => {
    const { plays, play } = setup();
    play(1, 600_000, 0, 29_800);
    expect(plays).toEqual([]);
    play(1, 600_000, 30_000, 90_000);
    expect(plays).toEqual([{ trackId: 1, listenedMs: 30_000 }]);
  });

  it('records a short track at half its length', () => {
    const { plays, play } = setup();
    play(1, 40_000, 0, 19_800);
    expect(plays).toEqual([]);
    play(1, 40_000, 20_000, 20_000);
    expect(plays).toEqual([{ trackId: 1, listenedMs: 20_000 }]);
  });

  it('does not count a seek', () => {
    const { plays, play } = setup();
    play(1, 600_000, 0, 10_000);
    play(1, 600_000, 300_000, 310_000);
    expect(plays).toEqual([]);
    play(1, 600_000, 100_000, 110_000);
    expect(plays).toEqual([{ trackId: 1, listenedMs: 30_000 }]);
  });

  it('does not count going back to hear it again as another play', () => {
    const { plays, play } = setup();
    play(1, 600_000, 0, 40_000);
    play(1, 600_000, 0, 40_000);
    expect(plays).toHaveLength(1);
  });

  it('counts a new listen of the same track as another play', () => {
    const { log, plays, play } = setup();
    play(1, 600_000, 0, 40_000);
    log.stopped();
    play(2, 600_000, 0, 40_000);
    expect(plays).toHaveLength(2);
  });

  it('forgets a track skipped before it counts', () => {
    const { log, plays, saved, play } = setup();
    play(1, 600_000, 0, 10_000);
    log.stopped();
    expect(plays).toEqual([]);
    expect(saved).toEqual([]);
  });

  it('saves the time in batches, and what is left when it stops', () => {
    const { log, saved, play } = setup();
    play(1, 600_000, 0, 30_000);
    expect(saved).toEqual([]);
    play(1, 600_000, 30_200, 60_000);
    expect(saved).toEqual([[1, 60_000]]);
    play(1, 600_000, 60_200, 65_000);
    log.stopped();
    expect(saved.at(-1)).toEqual([1, 65_000]);
    expect(saved).toHaveLength(2);
    log.stopped();
    expect(saved).toHaveLength(2);
  });

  it('survives a play that could not be written', () => {
    const saved: unknown[] = [];
    const log = createListenLog({ recordPlay: () => null, saveListened: (...row) => saved.push(row) });
    for (let positionMs = 0; positionMs <= 60_000; positionMs += 200) {
      log.position({ listen: 1, trackId: 1, durationMs: 600_000, positionMs });
    }
    log.stopped();
    expect(saved).toEqual([]);
  });
});
