import { describe, expect, it } from 'vitest';
import type { EngineData } from './engine';
import { seededRandom, TUNING, wanderTuning } from './engine';
import { blendVector, decadeGroups, resolveStart, startOptions, type StartTrack } from './radioStart';

function track(id: number, vector: number, overrides: Partial<StartTrack> = {}): StartTrack {
  return {
    id,
    artistKey: `artist ${id}`,
    titleKey: `title ${id}`,
    genres: [],
    plays: 0,
    skips: 0,
    isMissing: false,
    theme: null,
    vector,
    artistId: id,
    year: null,
    mains: [],
    ...overrides,
  };
}

function dataOf(tracks: StartTrack[], rows: number[][]): EngineData {
  return {
    tracks,
    vectors: Float32Array.from(rows.flat()),
    dimensions: rows[0]?.length ?? 0,
    artistLinks: new Map(),
    trackLinks: new Map(),
    hubs: null,
    energy: null,
  };
}

const CONTEXT = { random: seededRandom(1), lastPlayed: new Map<number, number>(), now: 1_000_000_000_000, season: null };

describe('wanderTuning', () => {
  it("is today's radio at the middle", () => {
    expect(wanderTuning(0.5)).toMatchObject({
      scoreFloor: TUNING.scoreFloor,
      seedDecay: TUNING.seedDecay,
      jitter: TUNING.jitter,
    });
  });

  it('loosens everything on the way from same vibe to adventurous', () => {
    const steps = [0, 0.25, 0.5, 0.75, 1].map(wanderTuning);
    for (const [index, step] of steps.slice(1).entries()) {
      const before = steps[index];
      expect(step.scoreFloor).toBeLessThan(before?.scoreFloor ?? 0);
      expect(step.seedDecay).toBeLessThan(before?.seedDecay ?? 0);
      expect(step.jitter).toBeGreaterThan(before?.jitter ?? 0);
      expect(step.originPull).toBeLessThan(before?.originPull ?? 0);
    }
  });

  it('holds at its ends', () => {
    expect(wanderTuning(-1)).toEqual(wanderTuning(0));
    expect(wanderTuning(2)).toEqual(wanderTuning(1));
  });
});

describe('decadeGroups', () => {
  it('has only the decades present, oldest first, and ignores what cannot be a year', () => {
    expect(decadeGroups([1979, 1971, 2004, null, 0, 9999])).toEqual([
      { decade: 1970, tracks: 2 },
      { decade: 2000, tracks: 1 },
    ]);
  });
});

describe('blendVector', () => {
  it('comes out at length one, with each part counting the same however long it is', () => {
    const blend = blendVector([Float32Array.of(10, 0), Float32Array.of(0, 1)]);
    expect(blend?.[0]).toBeCloseTo(Math.SQRT1_2);
    expect(blend?.[1]).toBeCloseTo(Math.SQRT1_2);
  });

  it('has nothing to give for silence or no parts', () => {
    expect(blendVector([])).toBeNull();
    expect(blendVector([Float32Array.of(0, 0)])).toBeNull();
  });
});

describe('resolveStart', () => {
  const tracks = [
    track(1, 0, { mains: ['Rock'], year: 1975 }),
    track(2, 1, { mains: ['Rock'], year: 1978 }),
    track(3, 2, { mains: ['Jazz'], year: 1961 }),
    track(4, -1, { mains: ['Folk'], year: 1990 }),
    track(5, 3, { mains: ['Rock'], isMissing: true }),
  ];
  const data = dataOf(tracks, [
    [1, 0],
    [0.9, 0.1],
    [0, 1],
    [1, 0],
  ]);

  it('counts only what is there for the options', () => {
    expect(startOptions(tracks)).toEqual({
      genres: [
        { name: 'Rock', tracks: 2 },
        { name: 'Folk', tracks: 1 },
        { name: 'Jazz', tracks: 1 },
      ],
      decades: [
        { decade: 1960, tracks: 1 },
        { decade: 1970, tracks: 2 },
        { decade: 1990, tracks: 1 },
      ],
      tracks: 4,
      fingerprinted: 3,
    });
  });

  it('seeds a genre from its own tracks and ends on the one to play', () => {
    const start = resolveStart(data, tracks, { kind: 'genre', genre: 'Rock' }, CONTEXT);
    if ('problem' in start) throw new Error(start.problem);
    expect(start.seeds.toSorted()).toEqual([1, 2]);
    expect(start.seeds.at(-1)).toBe(start.first);
  });

  it('says so when what was chosen has no fingerprints', () => {
    expect(resolveStart(data, tracks, { kind: 'genre', genre: 'Folk' }, CONTEXT)).toEqual({
      problem: 'no-fingerprints',
    });
    const parts = [
      { kind: 'track', id: 1 },
      { kind: 'track', id: 4 },
    ] as const;
    expect(resolveStart(data, tracks, { kind: 'blend', parts: [...parts] }, CONTEXT)).toEqual({
      problem: 'no-fingerprints',
    });
  });

  it('starts a blend between its parts, and from outside them when it can', () => {
    const parts = [
      { kind: 'track', id: 1 },
      { kind: 'artist', id: 3 },
    ] as const;
    const start = resolveStart(data, tracks, { kind: 'blend', parts: [...parts] }, CONTEXT);
    if ('problem' in start) throw new Error(start.problem);
    expect(start.first).toBe(2);
    expect(start.seeds).toEqual([1, 3, 2]);
    expect(Math.hypot(...(start.origin ?? []))).toBeCloseTo(1);
  });

  it('leaves out what was played lately, and keeps it out of the first picks', () => {
    const { now } = CONTEXT;
    const lastPlayed = new Map([
      [1, now - 1000],
      [2, now - 1000],
    ]);
    const start = resolveStart(data, tracks, { kind: 'forgotten' }, { ...CONTEXT, lastPlayed });
    if ('problem' in start) throw new Error(start.problem);
    expect(start.first).toBe(3);
    expect(start.avoid).toEqual([1, 2]);
  });

  it('lands in the same place for the same surprise seed', () => {
    const at = (seed: number) =>
      resolveStart(data, tracks, { kind: 'surprise', randomSeed: seed }, { ...CONTEXT, random: seededRandom(seed) });
    expect(at(42)).toEqual(at(42));
    const firsts = new Set(
      Array.from({ length: 20 }, (_, seed) => at(seed)).map((start) => 'first' in start && start.first),
    );
    expect(firsts.size).toBeGreaterThan(1);
  });
});
