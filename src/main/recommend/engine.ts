/*
 * What to play given what's been playing: pure, over data handed to it. Each signal that has something to say about the
 * seeds counts, and one that doesn't is left out, so it works on sound alone, on listeners alone, or on both.
 */

export const TUNING = {
  weights: { audio: 0.5, artistLink: 0.25, trackLink: 0.25 },
  /** Cosines of these vectors run from about 0.25 between strangers to 0.85 between close neighbours. */
  audioFloor: 0.35,
  audioCeiling: 0.85,
  /** What another track by the same artist counts for as an artist link. The cap stops them taking over. */
  sameArtistLink: 0.6,
  genreBonus: 0.05,
  playsBonus: 0.03,
  playsForFullBonus: 20,
  skipPenalty: 0.02,
  maxSkipPenalty: 0.1,
  hubPenalty: 0.2,
  /** A newer seed counts this many times less than the one after it. */
  seedDecay: 0.75,
  scoreFloor: 0.3,
  jitter: 0.04,
  hubs: { sampleSize: 400, neighbours: 10, overExpected: 3, fullPenaltyAt: 12 },
} as const;

export type EngineTrack = {
  id: number;
  artistKey: string;
  titleKey: string;
  genres: readonly number[];
  plays: number;
  skips: number;
  isMissing: boolean;
  /** Which row of `vectors` is its fingerprint, or -1. */
  vector: number;
};

export type EngineData = {
  tracks: readonly EngineTrack[];
  vectors: Float32Array;
  dimensions: number;
  /** Both ways round, between owned artists only. 0 to 1. */
  artistLinks: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** Between owned songs, by `songKey`. */
  trackLinks: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** 0 to 1 by row of `vectors`: how much of a hub each one is. */
  hubs: Float32Array | null;
};

export type RecommendRequest = {
  /** Oldest first, for the last few played. */
  seeds: readonly number[];
  /** Never suggested, whatever their score. */
  exclude: readonly number[];
  /** Count against the per-artist cap, as what was just played does. */
  recent: readonly number[];
  count: number;
  maxPerArtist: number;
  randomSeed: number;
};

export function songKey(artistKey: string, titleKey: string): string {
  return `${artistKey}\t${titleKey}`;
}

/** Small and seeded, so a list can come out the same every time it's asked for. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

/** Seeds' weights by how recent they are, and the same seeds with vectors, averaged, since cosines add up that way. */
function centroidOf(data: EngineData, seeds: readonly EngineTrack[]): Float32Array | null {
  const { vectors, dimensions } = data;
  const centroid = new Float64Array(dimensions);
  let weight = 0;
  seeds.forEach((seed, index) => {
    if (seed.vector < 0) return;
    const seedWeight = TUNING.seedDecay ** (seeds.length - 1 - index);
    const start = seed.vector * dimensions;
    for (let i = 0; i < dimensions; i++) {
      centroid[i] = (centroid[i] as number) + (vectors[start + i] as number) * seedWeight;
    }
    weight += seedWeight;
  });
  if (weight === 0) return null;
  return Float32Array.from(centroid, (value) => value / weight);
}

function audioScore(data: EngineData, centroid: Float32Array, row: number): number {
  const { vectors, dimensions } = data;
  const start = row * dimensions;
  let sum = 0;
  for (let i = 0; i < dimensions; i++) sum += (centroid[i] as number) * (vectors[start + i] as number);
  return clamp01((sum - TUNING.audioFloor) / (TUNING.audioCeiling - TUNING.audioFloor));
}

/** What the seeds' links add up to, the same way their sound does. Empty means there's nothing known about any of them. */
function linksFrom(
  keys: readonly string[],
  links: ReadonlyMap<string, ReadonlyMap<string, number>>,
): Map<string, number> {
  const total = new Map<string, number>();
  let weight = 0;
  keys.forEach((key, index) => {
    const seedWeight = TUNING.seedDecay ** (keys.length - 1 - index);
    weight += seedWeight;
    for (const [target, score] of links.get(key) ?? []) {
      total.set(target, (total.get(target) ?? 0) + score * seedWeight);
    }
  });
  for (const [target, score] of total) total.set(target, score / weight);
  return total;
}

function jaccard(seedGenres: ReadonlySet<number>, genres: readonly number[]): number {
  if (seedGenres.size === 0 || genres.length === 0) return 0;
  const shared = genres.filter((genre) => seedGenres.has(genre)).length;
  return shared / (seedGenres.size + genres.length - shared);
}

export type Scored = { track: EngineTrack; score: number };

export function scoreCandidates(data: EngineData, request: RecommendRequest): Scored[] {
  const byId = new Map(data.tracks.map((track) => [track.id, track]));
  const seeds = request.seeds.flatMap((id) => byId.get(id) ?? []);
  if (seeds.length === 0) return [];

  const centroid = centroidOf(data, seeds);
  const seedArtists = seeds.map(({ artistKey }) => artistKey);
  const artistScores = linksFrom(seedArtists, data.artistLinks);
  const trackScores = linksFrom(
    seeds.map(({ artistKey, titleKey }) => songKey(artistKey, titleKey)),
    data.trackLinks,
  );
  const hasArtistLinks = artistScores.size > 0;
  const hasTrackLinks = trackScores.size > 0;
  if (centroid === null && !hasArtistLinks && !hasTrackLinks) return [];

  const seedArtistSet = new Set(seedArtists);
  const seedSongs = new Set(seeds.map(({ artistKey, titleKey }) => songKey(artistKey, titleKey)));
  const seedGenres = new Set(seeds.flatMap(({ genres }) => genres));
  const excluded = new Set(request.exclude);
  const { weights } = TUNING;

  return data.tracks.flatMap((track): Scored[] => {
    const song = songKey(track.artistKey, track.titleKey);
    if (track.isMissing || excluded.has(track.id) || seedSongs.has(song)) return [];

    let total = 0;
    let weight = 0;
    if (centroid !== null && track.vector >= 0) {
      total += weights.audio * audioScore(data, centroid, track.vector);
      weight += weights.audio;
    }
    if (hasArtistLinks) {
      const link = seedArtistSet.has(track.artistKey) ? TUNING.sameArtistLink : 0;
      total += weights.artistLink * Math.max(link, artistScores.get(track.artistKey) ?? 0);
      weight += weights.artistLink;
    }
    if (hasTrackLinks) {
      total += weights.trackLink * (trackScores.get(song) ?? 0);
      weight += weights.trackLink;
    }
    if (weight === 0) return [];

    const hub = track.vector >= 0 ? (data.hubs?.[track.vector] ?? 0) : 0;
    const plays = Math.min(track.plays / TUNING.playsForFullBonus, 1);
    const skips = Math.min(track.skips * TUNING.skipPenalty, TUNING.maxSkipPenalty);
    const score =
      total / weight +
      TUNING.genreBonus * jaccard(seedGenres, track.genres) +
      TUNING.playsBonus * plays -
      TUNING.hubPenalty * hub -
      skips;
    return [{ track, score }];
  });
}

/** Best first with a little luck on top, above the floor, and no more of one artist than the cap. */
export function recommend(data: EngineData, request: RecommendRequest): number[] {
  const random = seededRandom(request.randomSeed);
  const ranked = scoreCandidates(data, request)
    .filter(({ score }) => score >= TUNING.scoreFloor)
    .map(({ track, score }) => ({ track, rank: score + random() * TUNING.jitter }))
    .toSorted((a, b) => b.rank - a.rank);

  const byId = new Map(data.tracks.map((track) => [track.id, track]));
  const perArtist = new Map<string, number>();
  for (const id of request.recent) {
    const artist = byId.get(id)?.artistKey;
    if (artist !== undefined) perArtist.set(artist, (perArtist.get(artist) ?? 0) + 1);
  }

  const picked: number[] = [];
  const songs = new Set<string>();
  for (const { track } of ranked) {
    if (picked.length === request.count) break;
    const already = perArtist.get(track.artistKey) ?? 0;
    const song = songKey(track.artistKey, track.titleKey);
    if (already >= request.maxPerArtist || songs.has(song)) continue;
    perArtist.set(track.artistKey, already + 1);
    songs.add(song);
    picked.push(track.id);
  }
  return picked;
}

/**
 * Some vectors sit near everything, and turn up beside music they have nothing to do with. Each sampled track's nearest
 * neighbours vote: a row with several times its fair share of votes gets a penalty, growing with how far past it goes.
 */
export function hubScores(
  vectors: Float32Array,
  dimensions: number,
  random: () => number = seededRandom(1),
): Float32Array {
  const rows = dimensions === 0 ? 0 : vectors.length / dimensions;
  const { sampleSize, neighbours, overExpected, fullPenaltyAt } = TUNING.hubs;
  const scores = new Float32Array(rows);
  if (rows <= neighbours + 1) return scores;

  const sample = Math.min(sampleSize, rows);
  const votes = new Uint32Array(rows);
  const nearest = new Float32Array(rows);
  const order = Array.from({ length: rows }, (_, row) => row);
  for (let drawn = 0; drawn < sample; drawn++) {
    const swap = drawn + Math.floor(random() * (rows - drawn));
    const query = order[swap] as number;
    order[swap] = order[drawn] as number;
    order[drawn] = query;

    const start = query * dimensions;
    for (let row = 0; row < rows; row++) {
      const other = row * dimensions;
      let sum = 0;
      for (let i = 0; i < dimensions; i++) sum += (vectors[start + i] as number) * (vectors[other + i] as number);
      nearest[row] = row === query ? -2 : sum;
    }
    const top = topRows(nearest, neighbours);
    for (const row of top) votes[row] = (votes[row] as number) + 1;
  }

  const fairShare = (sample * neighbours) / rows;
  for (let row = 0; row < rows; row++) {
    const share = (votes[row] as number) / fairShare;
    scores[row] = clamp01((share - overExpected) / (fullPenaltyAt - overExpected));
  }
  return scores;
}

function topRows(values: Float32Array, count: number): number[] {
  const top: number[] = [];
  for (let row = 0; row < values.length; row++) {
    const value = values[row] as number;
    const smallest = top.length < count ? -Infinity : (values[top[top.length - 1] as number] as number);
    if (value <= smallest) continue;
    let at = Math.min(top.length, count - 1);
    if (top.length < count) top.push(row);
    while (at > 0 && (values[top[at - 1] as number] as number) < value) {
      top[at] = top[at - 1] as number;
      at -= 1;
    }
    top[at] = row;
  }
  return top;
}
