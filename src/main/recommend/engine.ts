/*
 * What to play given what's been playing: pure, over data handed to it. Each signal that has something to say about the
 * seeds counts, and one that doesn't is left out, so it works on sound alone, on listeners alone, or on both.
 */

import { WANDER_MIDDLE, type RadioEnergy } from '@shared/domain';
import type { ThemeId } from '@shared/themes';
import {
  afterPick,
  ENERGY_RULES,
  energyState,
  energyTuning,
  fitsSlot,
  nextSlot,
  steadySlot,
  type EnergySlot,
  type EnergyState,
  type EnergyTuning,
} from './energy';
import { floorLift, themeBonus, type SeasonAsk } from './seasons';

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

/** What the Wander slider moves. The middle stop is the tuning above, so a wander of 0.5 plays as radio always has. */
export type WanderTuning = {
  scoreFloor: number;
  seedDecay: number;
  jitter: number;
  /** How much of the centroid stays at where radio started, rather than following what's been played. */
  originPull: number;
};

const WANDER_STOPS: readonly [WanderTuning, WanderTuning, WanderTuning] = [
  { scoreFloor: 0.4, seedDecay: 1, jitter: 0.01, originPull: 0.7 },
  { scoreFloor: TUNING.scoreFloor, seedDecay: TUNING.seedDecay, jitter: TUNING.jitter, originPull: 0.3 },
  { scoreFloor: 0.15, seedDecay: 0.35, jitter: 0.6, originPull: 0 },
];

export function wanderTuning(wander: number): WanderTuning {
  const clamped = Math.min(Math.max(wander, 0), 1);
  const [same, middle, far] = WANDER_STOPS;
  const [from, to, at] = clamped < 0.5 ? [same, middle, clamped * 2] : [middle, far, clamped * 2 - 1];
  const mix = (key: keyof WanderTuning) => from[key] + (to[key] - from[key]) * at;
  return {
    scoreFloor: mix('scoreFloor'),
    seedDecay: mix('seedDecay'),
    jitter: mix('jitter'),
    originPull: mix('originPull'),
  };
}

export type EngineTrack = {
  id: number;
  artistKey: string;
  titleKey: string;
  genres: readonly number[];
  /** Each genre it's in by name, sub genres' siblings included, for radio that stays in one. */
  families: readonly string[];
  plays: number;
  skips: number;
  isMissing: boolean;
  /** Which row of `vectors` is its fingerprint, or -1. */
  vector: number;
  theme: ThemeId | null;
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
  /** 0 to 1 by row of `vectors`, or null without the models, and then radio goes by similarity alone. */
  energy: Float32Array | null;
};

export type RadioEnergyAsk = {
  settings: RadioEnergy;
  /** Oldest first, up to the last pick waiting in the queue. */
  history: readonly number[];
  /** Which of those were asked for as calm picks. */
  calm: readonly number[];
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
  /** 0 to 1, or null for the middle. Only radio has it. */
  wander: number | null;
  /** Where radio started, as a fingerprint, for it to keep some of. */
  origin: Float32Array | null;
  /** Only radio has it. */
  energy: RadioEnergyAsk | null;
  /** Null with seasons off. */
  season: SeasonAsk | null;
  /** Radio's only, and only when started from something it should stay in. It plays those songs again rather than leave. */
  within: EngineWithin | null;
};

/** What a run stays within, as the engine needs it: a mood station comes as the tracks it plays. */
export type EngineWithin = { kind: 'genre'; genre: string } | { kind: 'tracks'; trackIds: ReadonlySet<number> };

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
function centroidOf(
  data: EngineData,
  seeds: readonly EngineTrack[],
  { seedDecay, originPull }: WanderTuning,
  origin: Float32Array | null,
): Float32Array | null {
  const { vectors, dimensions } = data;
  const centroid = new Float64Array(dimensions);
  let weight = 0;
  seeds.forEach((seed, index) => {
    if (seed.vector < 0) return;
    const seedWeight = seedDecay ** (seeds.length - 1 - index);
    const start = seed.vector * dimensions;
    for (let i = 0; i < dimensions; i++) {
      centroid[i] = (centroid[i] as number) + (vectors[start + i] as number) * seedWeight;
    }
    weight += seedWeight;
  });
  if (weight === 0) return origin;
  if (origin === null) return Float32Array.from(centroid, (value) => value / weight);
  return Float32Array.from(
    centroid,
    (value, i) => (value / weight) * (1 - originPull) + (origin[i] as number) * originPull,
  );
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
  seedDecay: number,
): Map<string, number> {
  const total = new Map<string, number>();
  let weight = 0;
  keys.forEach((key, index) => {
    const seedWeight = seedDecay ** (keys.length - 1 - index);
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

function insideOf(within: EngineWithin | null): (track: EngineTrack) => boolean {
  if (within === null) return () => true;
  switch (within.kind) {
    case 'genre':
      return ({ families }) => families.includes(within.genre);
    case 'tracks':
      return ({ id }) => within.trackIds.has(id);
  }
}

export function scoreCandidates(data: EngineData, request: RecommendRequest): Scored[] {
  const byId = new Map(data.tracks.map((track) => [track.id, track]));
  const seeds = request.seeds.flatMap((id) => byId.get(id) ?? []);
  if (seeds.length === 0) return [];

  const tuning = wanderTuning(request.wander ?? WANDER_MIDDLE);
  const centroid = centroidOf(data, seeds, tuning, request.origin);
  const seedArtists = seeds.map(({ artistKey }) => artistKey);
  const artistScores = linksFrom(seedArtists, data.artistLinks, tuning.seedDecay);
  const trackScores = linksFrom(
    seeds.map(({ artistKey, titleKey }) => songKey(artistKey, titleKey)),
    data.trackLinks,
    tuning.seedDecay,
  );
  const hasArtistLinks = artistScores.size > 0;
  const hasTrackLinks = trackScores.size > 0;
  if (centroid === null && !hasArtistLinks && !hasTrackLinks) return [];

  const seedArtistSet = new Set(seedArtists);
  const seedSongs = new Set(seeds.map(({ artistKey, titleKey }) => songKey(artistKey, titleKey)));
  const seedGenres = new Set(seeds.flatMap(({ genres }) => genres));
  const excluded = new Set(request.exclude);
  const { weights } = TUNING;
  const isInside = insideOf(request.within);

  return data.tracks.flatMap((track): Scored[] => {
    const song = songKey(track.artistKey, track.titleKey);
    if (track.isMissing || excluded.has(track.id) || seedSongs.has(song) || !isInside(track)) return [];

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

function energyOf({ energy }: EngineData, track: EngineTrack | undefined): number | null {
  if (energy === null || track === undefined || track.vector < 0) return null;
  return energy[track.vector] ?? null;
}

type EnergyPlan = { tuning: EnergyTuning; state: EnergyState };

function energyPlan(
  data: EngineData,
  ask: RadioEnergyAsk | null,
  byId: ReadonlyMap<number, EngineTrack>,
): EnergyPlan | null {
  if (ask === null || data.energy === null) return null;
  const tuning = energyTuning(ask.settings);
  const calm = new Set(ask.calm);
  const state = energyState(
    ask.history.map((id) => ({ energy: energyOf(data, byId.get(id)), isCalm: calm.has(id) })),
    tuning.returnPicks,
  );
  return state === null ? null : { tuning, state };
}

function seasonRules({ season, seeds }: RecommendRequest, byId: ReadonlyMap<number, EngineTrack>) {
  const themeOf = (id: number) => byId.get(id)?.theme ?? null;
  const asked = (season?.asked ?? []).map(themeOf);
  return { bonus: themeBonus(season, seeds.map(themeOf), asked), lift: floorLift(season, asked) };
}

export type Picks = {
  trackIds: number[];
  /** Those picked for being calmer, for the next ask to measure from. */
  calmPicks: number[];
};

/**
 * Best first with a little luck on top, above the floor, and no more of one artist than the cap. Energy only chooses among
 * what's already there: a slot nothing close can fill plays the ordinary pick instead. Without energy it's only that.
 * A season's bonus comes after the floor, so a date can't bring in a song that doesn't fit. What's hidden still draws its
 * luck, so hiding a song leaves every other song's luck as it was. In a run asked to stay with a theme, energy doesn't get
 * to turn that theme's songs away, since it has few enough already.
 */
export function pickTracks(data: EngineData, request: RecommendRequest): Picks {
  const random = seededRandom(request.randomSeed);
  const { scoreFloor, jitter } = wanderTuning(request.wander ?? WANDER_MIDDLE);
  const byId = new Map(data.tracks.map((track) => [track.id, track]));
  const plan = energyPlan(data, request.energy, byId);
  const lean = plan?.tuning.lean ?? 0;
  const { bonus, lift } = seasonRules(request, byId);
  const ranked = scoreCandidates(data, request)
    // Everything a run stays within fits it, however far apart it sounds.
    .filter(({ track, score }) => request.within !== null || score + lift(track.theme) >= scoreFloor)
    .flatMap(({ track, score }) => {
      const luck = random() * jitter;
      const extra = bonus(track.theme);
      if (extra === null) return [];
      return [{ track, rank: score + luck + lean * (energyOf(data, track) ?? plan?.state.anchor ?? 0) + extra }];
    })
    .toSorted((a, b) => b.rank - a.rank);

  const perArtist = new Map<string, number>();
  for (const id of request.recent) {
    const artist = byId.get(id)?.artistKey;
    if (artist !== undefined) perArtist.set(artist, (perArtist.get(artist) ?? 0) + 1);
  }

  const songs = new Set<string>();
  const isAllowed = (track: EngineTrack) =>
    (perArtist.get(track.artistKey) ?? 0) < request.maxPerArtist &&
    !songs.has(songKey(track.artistKey, track.titleKey));
  const closest = ranked.slice(0, ENERGY_RULES.closestPicks);
  const fillSlot = (slot: EnergySlot) =>
    closest.find(({ track }) => isAllowed(track) && (lift(track.theme) > 0 || fitsSlot(slot, energyOf(data, track))))
      ?.track ?? null;

  const trackIds: number[] = [];
  const calmPicks: number[] = [];
  let state = plan?.state ?? null;
  while (trackIds.length < request.count) {
    const slot = plan === null || state === null ? null : nextSlot(state, plan.tuning, random);
    const asked = slot === null ? null : fillSlot(slot);
    const steady = asked ?? (plan === null || state === null ? null : fillSlot(steadySlot(state, plan.tuning)));
    const track = steady ?? ranked.find((entry) => isAllowed(entry.track))?.track;
    if (track === undefined) break;

    perArtist.set(track.artistKey, (perArtist.get(track.artistKey) ?? 0) + 1);
    songs.add(songKey(track.artistKey, track.titleKey));
    trackIds.push(track.id);
    const wasCalm = asked !== null && slot?.kind === 'calm';
    if (wasCalm) calmPicks.push(track.id);
    if (state !== null) state = afterPick(state, wasCalm, energyOf(data, track));
  }
  for (const track of request.within === null ? [] : comingRound(data, request, bonus)) {
    if (trackIds.length >= request.count) break;
    const song = songKey(track.artistKey, track.titleKey);
    if (songs.has(song)) continue;
    songs.add(song);
    trackIds.push(track.id);
  }
  return { trackIds, calmPicks };
}

/** What a run stays within once it has all been played, the longest unheard first. */
function comingRound(
  { tracks }: EngineData,
  { within, exclude, seeds }: RecommendRequest,
  bonus: (theme: ThemeId | null) => number | null,
): EngineTrack[] {
  const isInside = insideOf(within);
  const heardAt = new Map([...exclude, ...seeds].map((id, at) => [id, at]));
  return tracks
    .filter((track) => !track.isMissing && isInside(track) && bonus(track.theme) !== null)
    .toSorted((a, b) => (heardAt.get(a.id) ?? -1) - (heardAt.get(b.id) ?? -1));
}

export function recommend(data: EngineData, request: RecommendRequest): number[] {
  return pickTracks(data, request).trackIds;
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
