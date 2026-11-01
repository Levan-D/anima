import { describe, expect, it } from 'vitest';
import {
  afterPick,
  blendEnergy,
  energyState,
  energyTuning,
  fitsSlot,
  nextSlot,
  percentiles,
  type EnergyHistoryItem,
  type EnergyState,
  type EnergyTuning,
} from './energy';
import { pickTracks, seededRandom, type EngineData, type EngineTrack, type RecommendRequest } from './engine';

const MIDDLE = energyTuning(0.5);

function normal(energy: number | null): EnergyHistoryItem {
  return { energy, isCalm: false };
}

describe('percentiles and the blend', () => {
  it('ranks from 0 to 1, with ties sharing their middle', () => {
    expect([...percentiles([10, 30, 20, 20, 40])]).toEqual([0, 0.75, 0.375, 0.375, 1]);
  });

  it('averages each head by rank, so a scale counts for nothing', () => {
    const blend = blendEnergy([
      [0.001, 0.002, 0.003],
      [300, 100, 200],
    ]);
    expect(blend[0]).toBeCloseTo(0.5);
    expect(blend[1]).toBeCloseTo(0.25);
    expect(blend[2]).toBeCloseTo(0.75);
  });
});

describe('energyTuning', () => {
  it('dips about every five at the middle, more when calm, and never at the intense end', () => {
    expect(energyTuning(0.5).dipsPerPick).toBeCloseTo(0.2);
    expect(energyTuning(0).dipsPerPick).toBeGreaterThan(0.2);
    expect(energyTuning(1).dipsPerPick).toBe(0);
    expect(energyTuning(0.5).lean).toBe(0);
    expect(energyTuning(0).lean).toBeLessThan(0);
    expect(energyTuning(1).lean).toBeGreaterThan(0);
  });
});

describe('energyState', () => {
  it('measures from ordinary picks, so dips and their return leave the anchor where it was', () => {
    const history = [normal(0.7), normal(0.72), { energy: 0.45, isCalm: true }, normal(0.5), normal(0.6), normal(0.68)];
    const state = energyState(history, 2);
    expect(state?.anchor).toBeCloseTo(0.7);
    expect(state?.sinceCalm).toBe(3);
    expect(state?.calmEnergy).toBe(0.45);
  });

  it('has nothing to measure from when no track has an energy', () => {
    expect(energyState([normal(null), normal(null)], 2)).toBeNull();
    expect(energyState([], 2)).toBeNull();
  });
});

describe('nextSlot', () => {
  const gaps = (tuning: EnergyTuning) => {
    const random = seededRandom(9);
    const seen = new Set<number>();
    for (let run = 0; run < 400; run++) {
      let state: EnergyState = { anchor: 0.7, sinceCalm: 0, calmEnergy: null, last: 0.7 };
      for (let gap = 1; gap < 40; gap++) {
        if (nextSlot(state, tuning, random).kind === 'calm') {
          seen.add(gap);
          break;
        }
        state = afterPick(state, false, 0.7);
      }
    }
    return [...seen].toSorted((a, b) => a - b);
  };

  it('asks for a calm pick every 4 to 6 at the middle', () => {
    expect(gaps(MIDDLE)).toEqual([4, 5, 6]);
  });

  it('asks more often when calm, and not at all at the intense end', () => {
    expect(gaps(energyTuning(0))).toEqual([2, 3]);
    expect(gaps(energyTuning(1))).toEqual([]);
  });

  it('wants at least the smallest gap that counts, and no more than the largest drop', () => {
    const slot = nextSlot({ anchor: 0.7, sinceCalm: 5, calmEnergy: null, last: 0.7 }, MIDDLE, () => 0);
    expect(slot.kind).toBe('calm');
    expect(fitsSlot(slot, 0.63)).toBe(false);
    expect(fitsSlot(slot, 0.6)).toBe(true);
    expect(fitsSlot(slot, 0.41)).toBe(true);
    expect(fitsSlot(slot, 0.39)).toBe(false);
    expect(fitsSlot(slot, null)).toBe(false);
  });

  it('waits when the last song is already well under the anchor', () => {
    const due = { anchor: 0.7, sinceCalm: 9, calmEnergy: null };
    expect(nextSlot({ ...due, last: 0.5 }, MIDDLE, () => 0).kind).toBe('ordinary');
    expect(nextSlot({ ...due, last: 0.7 }, MIDDLE, () => 0).kind).toBe('calm');
  });

  it('wants a calm pick to be a step down from the last song too', () => {
    const slot = nextSlot({ anchor: 0.7, sinceCalm: 9, calmEnergy: null, last: 0.65 }, MIDDLE, () => 0);
    expect(fitsSlot(slot, 0.6)).toBe(false);
    expect(fitsSlot(slot, 0.55)).toBe(true);
  });

  it('climbs back to the anchor after a dip', () => {
    const calm = { anchor: 0.7, sinceCalm: 0, calmEnergy: 0.4, last: 0.4 };
    const first = nextSlot(calm, MIDDLE, () => 0);
    const second = nextSlot({ ...calm, sinceCalm: 1 }, MIDDLE, () => 0);
    expect(first.kind).toBe('return');
    expect(fitsSlot(first, 0.5)).toBe(true);
    expect(fitsSlot(first, 0.7)).toBe(false);
    expect(fitsSlot(second, 0.6)).toBe(true);
    expect(fitsSlot(second, 0.4)).toBe(false);
    expect(nextSlot({ ...calm, sinceCalm: 2, last: 0.7 }, MIDDLE, () => 1).kind).toBe('ordinary');
  });
});

describe('energy in the engine', () => {
  function track(id: number, overrides: Partial<EngineTrack> = {}): EngineTrack {
    return {
      id,
      artistKey: `artist ${id}`,
      titleKey: `song ${id}`,
      genres: [],
      plays: 0,
      skips: 0,
      isMissing: false,
      vector: id - 1,
      ...overrides,
    };
  }

  /** Track 1 is the seed, and the rest get further from it as ids go up, starting where cosines stop being clamped. */
  function library(energies: number[], degreesApart = 3): EngineData {
    const vectors = energies.flatMap((_, i) => {
      const radians = ((i === 0 ? 0 : 32 + i * degreesApart) * Math.PI) / 180;
      return [Math.cos(radians), Math.sin(radians)];
    });
    return {
      tracks: energies.map((_, i) => track(i + 1)),
      vectors: Float32Array.from(vectors),
      dimensions: 2,
      artistLinks: new Map(),
      trackLinks: new Map(),
      hubs: null,
      energy: Float32Array.from(energies),
    };
  }

  function ask(overrides: Partial<RecommendRequest['energy'] & object> = {}, count = 1): RecommendRequest {
    return {
      seeds: [1],
      exclude: [1],
      recent: [],
      count,
      maxPerArtist: 2,
      randomSeed: 3,
      wander: 0,
      origin: null,
      // Six ordinary picks in, so a dip is due.
      energy: { slider: 0.5, history: [1, 1, 1, 1, 1, 1], calm: [], ...overrides },
    };
  }

  it('takes the closest match that is noticeably calmer when a dip is due, and says which', () => {
    const picks = pickTracks(library([0.7, 0.7, 0.65, 0.5, 0.45]), ask());
    expect(picks).toEqual({ trackIds: [4], calmPicks: [4] });
  });

  it('plays the ordinary pick when nothing close is calmer', () => {
    const picks = pickTracks(library([0.7, 0.7, 0.65, 0.68]), ask());
    expect(picks).toEqual({ trackIds: [2], calmPicks: [] });
  });

  it('never goes below the floor to reach a calm song', () => {
    const picks = pickTracks(library([0.7, 0.7, 0.45], 89), ask());
    expect(picks.calmPicks).toEqual([]);
    expect(picks.trackIds).toEqual([]);
  });

  it('leaves the artist cap standing', () => {
    const data = library([0.7, 0.7, 0.5, 0.5]);
    const tracks = [track(1, { artistKey: 'capped' }), track(2), track(3, { artistKey: 'capped' }), track(4)];
    const picks = pickTracks({ ...data, tracks }, { ...ask(), recent: [1], maxPerArtist: 1 });
    expect(picks.calmPicks).toEqual([4]);
  });

  it('only looks for a calm pick among the closest', () => {
    const energies = [...Array.from({ length: 70 }, () => 0.7), 0.5];
    const picks = pickTracks(library(energies, 0.1), ask());
    expect(picks).toEqual({ trackIds: [2], calmPicks: [] });
  });

  it('asks for the return in the next pick of the same batch', () => {
    const picks = pickTracks(library([0.7, 0.7, 0.72, 0.42, 0.55, 0.63]), ask({}, 3));
    expect(picks.trackIds[0]).toBe(4);
    expect(picks.trackIds[1]).toBe(5);
    expect(picks.trackIds[2]).toBe(6);
    expect(picks.calmPicks).toEqual([4]);
  });

  it('goes by similarity alone without the models, or without being asked', () => {
    const data = { ...library([0.7, 0.7, 0.65, 0.5]), energy: null };
    expect(pickTracks(data, ask({}, 3)).trackIds).toEqual([2, 3, 4]);
    expect(pickTracks(library([0.7, 0.7, 0.65, 0.5]), { ...ask({}, 3), energy: null })).toEqual({
      trackIds: [2, 3, 4],
      calmPicks: [],
    });
  });

  it('leans among ordinary picks at the ends, inside what qualifies', () => {
    const energies = [0.5, 0.9, 0.5, 0.1];
    const history = { history: [1], calm: [] };
    const calmEnd = pickTracks(library(energies), ask({ slider: 0, ...history }));
    const intenseEnd = pickTracks(library(energies), ask({ slider: 1, ...history }));
    expect(calmEnd.trackIds).toEqual([4]);
    expect(intenseEnd.trackIds).toEqual([2]);
  });
});
