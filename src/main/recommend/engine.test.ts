import { describe, expect, it } from 'vitest';
import {
  hubScores,
  recommend,
  seededRandom,
  songKey,
  type EngineData,
  type EngineTrack,
  type RecommendRequest,
} from './engine';

function track(id: number, artistKey: string, vector = -1, overrides: Partial<EngineTrack> = {}): EngineTrack {
  return {
    id,
    artistKey,
    titleKey: `song ${id}`,
    genres: [],
    plays: 0,
    skips: 0,
    isMissing: false,
    vector,
    ...overrides,
  };
}

/** Unit vectors in a plane, by angle: a small angle apart is close. */
function vectorsAt(degrees: number[]): Float32Array {
  return Float32Array.from(
    degrees.flatMap((angle) => [Math.cos((angle * Math.PI) / 180), Math.sin((angle * Math.PI) / 180)]),
  );
}

function data(tracks: EngineTrack[], overrides: Partial<EngineData> = {}): EngineData {
  return {
    tracks,
    vectors: new Float32Array(0),
    dimensions: 2,
    artistLinks: new Map(),
    trackLinks: new Map(),
    hubs: null,
    ...overrides,
  };
}

function ask(overrides: Partial<RecommendRequest> = {}): RecommendRequest {
  return { seeds: [1], exclude: [], recent: [], count: 10, maxPerArtist: 2, randomSeed: 7, wander: null, origin: null, ...overrides };
}

describe('recommend', () => {
  it('orders by sound alone when that is all there is', () => {
    const tracks = [track(1, 'a', 0), track(2, 'b', 1), track(3, 'c', 2), track(4, 'd', 3)];
    const picked = recommend(data(tracks, { vectors: vectorsAt([0, 85, 40, 55]) }), ask());
    expect(picked).toEqual([3, 4]);
  });

  it('orders by listeners alone when there are no fingerprints', () => {
    const artistLinks = new Map([
      [
        'a',
        new Map([
          ['b', 0.9],
          ['c', 0.4],
          ['d', 0.1],
        ]),
      ],
    ]);
    expect(
      recommend(data([track(1, 'a'), track(2, 'c'), track(3, 'b'), track(4, 'd')], { artistLinks }), ask()),
    ).toEqual([3, 2]);
  });

  it('blends track links with artist links', () => {
    const artistLinks = new Map([
      [
        'a',
        new Map([
          ['b', 0.6],
          ['c', 0.6],
        ]),
      ],
    ]);
    const trackLinks = new Map([[songKey('a', 'song 1'), new Map([[songKey('c', 'song 3'), 1]])]]);
    expect(recommend(data([track(1, 'a'), track(2, 'b'), track(3, 'c')], { artistLinks, trackLinks }), ask())[0]).toBe(
      3,
    );
  });

  it('has nothing to say with neither signal', () => {
    expect(recommend(data([track(1, 'a'), track(2, 'b')]), ask())).toEqual([]);
  });

  it('keeps to the floor even with room left', () => {
    const tracks = [track(1, 'a', 0), track(2, 'b', 1)];
    expect(recommend(data(tracks, { vectors: vectorsAt([0, 89]) }), ask())).toEqual([]);
  });

  it('caps an artist, counting what just played', () => {
    const tracks = [track(1, 'a', 0), track(2, 'b', 1), track(3, 'b', 2), track(4, 'b', 3), track(5, 'c', 4)];
    const input = { vectors: vectorsAt([0, 1, 2, 3, 20]) };
    expect(recommend(data(tracks, input), ask()).filter((id) => id >= 2 && id <= 4)).toHaveLength(2);
    const justPlayed = [...tracks, track(6, 'b', 5), track(7, 'b', 6)];
    const withThem = { vectors: vectorsAt([0, 1, 2, 3, 20, 90, 90]) };
    expect(recommend(data(justPlayed, withThem), ask({ recent: [6, 7], exclude: [6, 7] }))).toEqual([5]);
  });

  it('never gives back seeds, recent tracks, missing tracks or the seed song again', () => {
    const tracks = [
      track(1, 'a', 0),
      track(2, 'b', 1),
      track(3, 'c', 2, { isMissing: true }),
      track(4, 'a', 3, { titleKey: 'song 1' }),
      track(5, 'd', 4),
    ];
    const picked = recommend(data(tracks, { vectors: vectorsAt([0, 1, 2, 3, 4]) }), ask({ exclude: [2] }));
    expect(picked).toEqual([5]);
  });

  it('lets a hub lose to a track that is only a little further away', () => {
    const tracks = [track(1, 'a', 0), track(2, 'b', 1), track(3, 'c', 2)];
    const input = { vectors: vectorsAt([0, 30, 38]) };
    expect(recommend(data(tracks, input), ask({ count: 1 }))).toEqual([2]);
    const hubs = Float32Array.of(0, 1, 0);
    expect(recommend(data(tracks, { ...input, hubs }), ask({ count: 1 }))).toEqual([3]);
  });

  it('gives the same answer for the same seed, and can differ for another', () => {
    const tracks = Array.from({ length: 30 }, (_, i) => track(i + 1, `artist ${i}`, i));
    const input = data(tracks, { vectors: vectorsAt(tracks.map(() => 5)) });
    const first = recommend(input, ask({ count: 8, randomSeed: 1 }));
    expect(recommend(input, ask({ count: 8, randomSeed: 1 }))).toEqual(first);
    expect(recommend(input, ask({ count: 8, randomSeed: 2 }))).not.toEqual(first);
  });

  it('pays attention to what played last more than what played before', () => {
    const tracks = [track(1, 'a', 0), track(2, 'b', 1), track(3, 'c', 2), track(4, 'd', 3)];
    const input = data(tracks, { vectors: vectorsAt([0, 60, 8, 52]) });
    expect(recommend(input, ask({ seeds: [1, 2], count: 1 }))).toEqual([4]);
    expect(recommend(input, ask({ seeds: [2, 1], count: 1 }))).toEqual([3]);
  });
});

describe('hubScores', () => {
  it('finds the one that everything is close to', () => {
    // Strangers to each other, with a little noise to settle ties, and one row near all of them.
    const size = 130;
    const noise = seededRandom(5);
    const vectors = new Float32Array(size * size);
    for (let row = 1; row < size; row++) {
      for (let i = 0; i < size; i++) vectors[row * size + i] = (i === row ? 1 : 0) + (noise() - 0.5) * 0.01;
    }
    for (let i = 0; i < size; i++) vectors[i] = 1 / Math.sqrt(size);
    const scores = hubScores(vectors, size, seededRandom(3));
    expect(scores[0]).toBe(1);
    expect(Math.max(...scores.slice(1))).toBeLessThan(0.5);
  });

  it('has nothing to say about a handful of tracks', () => {
    expect([...hubScores(vectorsAt([0, 10, 20]), 2)]).toEqual([0, 0, 0]);
  });
});
