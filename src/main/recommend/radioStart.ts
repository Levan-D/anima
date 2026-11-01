/* Where radio starts when it's given a description instead of a track: pure, over the library the worker holds. */

import type { RadioProblem, RadioStartFrom, RadioStartOptions } from '@shared/domain';
import { TUNING, type EngineData, type EngineTrack } from './engine';

export type StartTrack = EngineTrack & {
  artistId: number;
  year: number | null;
  mains: readonly string[];
};

export type ResolvedStart = {
  /** What plays first. */
  first: number;
  /** Oldest first, ending with `first`. */
  seeds: number[];
  /** Normalized, or null if none of it has a fingerprint. */
  origin: Float32Array | null;
  /** Kept out of the first picks. */
  avoid: number[];
};

type Context = {
  random: () => number;
  /** Newest play by track, in the same clock as `now`. */
  lastPlayed: ReadonlyMap<number, number>;
  now: number;
};

const SEEDS = 5;
/** The seeds are drawn from this many of the most central, so the same pill doesn't start the same way every time. */
const CENTRAL_POOL = 24;
const FORGOTTEN_AFTER_MS = 90 * 24 * 60 * 60 * 1000;
const EARLIEST_YEAR = 1900;
const LATEST_YEAR = 2100;

export function normalized(vector: ArrayLike<number>): Float32Array | null {
  let sum = 0;
  for (let i = 0; i < vector.length; i++) sum += (vector[i] as number) ** 2;
  if (sum === 0) return null;
  const length = Math.sqrt(sum);
  return Float32Array.from({ length: vector.length }, (_, i) => (vector[i] as number) / length);
}

/** Each part counts the same, however loud or however many tracks stand behind it. */
export function blendVector(parts: readonly Float32Array[]): Float32Array | null {
  const first = parts[0];
  if (first === undefined) return null;
  const total = new Float64Array(first.length);
  for (const part of parts) {
    const unit = normalized(part);
    if (unit === null) continue;
    for (let i = 0; i < total.length; i++) total[i] = (total[i] as number) + (unit[i] as number);
  }
  return normalized(total);
}

/** Tags can say anything, so a year that can't be one has no decade. */
export function decadeOf(year: number | null): number | null {
  if (year === null || year < EARLIEST_YEAR || year > LATEST_YEAR) return null;
  return Math.floor(year / 10) * 10;
}

export function decadeGroups(years: Iterable<number | null>): { decade: number; tracks: number }[] {
  const counts = new Map<number, number>();
  for (const year of years) {
    const decade = decadeOf(year);
    if (decade !== null) counts.set(decade, (counts.get(decade) ?? 0) + 1);
  }
  return [...counts].map(([decade, tracks]) => ({ decade, tracks })).toSorted((a, b) => a.decade - b.decade);
}

export function startOptions(tracks: readonly StartTrack[]): Omit<RadioStartOptions, 'energy'> {
  const owned = tracks.filter(({ isMissing }) => !isMissing);
  const genres = new Map<string, number>();
  for (const { mains } of owned) for (const main of mains) genres.set(main, (genres.get(main) ?? 0) + 1);
  return {
    genres: [...genres]
      .map(([name, count]) => ({ name, tracks: count }))
      .toSorted((a, b) => b.tracks - a.tracks || a.name.localeCompare(b.name)),
    decades: decadeGroups(owned.map(({ year }) => year)),
    tracks: owned.length,
    fingerprinted: owned.filter(({ vector }) => vector >= 0).length,
  };
}

function vectorOf({ vectors, dimensions }: EngineData, { vector }: EngineTrack): Float32Array {
  return vectors.subarray(vector * dimensions, (vector + 1) * dimensions);
}

function averageOf(data: EngineData, tracks: readonly EngineTrack[]): Float32Array | null {
  const total = new Float64Array(data.dimensions);
  for (const track of tracks) {
    const vector = vectorOf(data, track);
    for (let i = 0; i < total.length; i++) total[i] = (total[i] as number) + (vector[i] as number);
  }
  return normalized(total);
}

/** Closest first. A hub sits near everything, so without its penalty the centre of any genre would be the same few tracks. */
function nearestTo<T extends EngineTrack>(data: EngineData, target: Float32Array, tracks: readonly T[]): T[] {
  const closeness = (track: T): number => {
    const vector = vectorOf(data, track);
    let sum = 0;
    for (let i = 0; i < target.length; i++) sum += (target[i] as number) * (vector[i] as number);
    return sum - TUNING.hubPenalty * (data.hubs?.[track.vector] ?? 0);
  };
  return tracks
    .map((track) => ({ track, score: closeness(track) }))
    .toSorted((a, b) => b.score - a.score)
    .map(({ track }) => track);
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

type Outcome = ResolvedStart | { problem: RadioProblem };

function fromSeeds(seeds: readonly EngineTrack[], origin: Float32Array | null, avoid: number[] = []): Outcome {
  const first = seeds.at(-1);
  if (first === undefined) return { problem: 'nothing-close' };
  return { first: first.id, seeds: seeds.map(({ id }) => id), origin, avoid };
}

/** The middle of a set of tracks, by sound, and a few from close to it. */
function fromCentre(data: EngineData, pool: readonly StartTrack[], random: () => number): Outcome {
  if (pool.length === 0) return { problem: 'nothing-close' };
  const heard = pool.filter(({ vector }) => vector >= 0);
  const origin = averageOf(data, heard);
  if (origin === null) return { problem: 'no-fingerprints' };
  const central = nearestTo(data, origin, heard).slice(0, CENTRAL_POOL);
  return fromSeeds(shuffled(central, random).slice(0, SEEDS), origin);
}

function fromBlend(
  data: EngineData,
  owned: readonly StartTrack[],
  parts: Extract<RadioStartFrom, { kind: 'blend' }>['parts'],
): Outcome {
  const partTracks = parts.map(({ kind, id }) =>
    owned.filter((track) => (kind === 'track' ? track.id === id : track.artistId === id)),
  );
  if (partTracks.some((tracks) => tracks.length === 0)) return { problem: 'nothing-close' };
  const heard = partTracks.map((tracks) => tracks.filter(({ vector }) => vector >= 0));
  const averages = heard.flatMap((tracks) => averageOf(data, tracks) ?? []);
  if (averages.length < parts.length) return { problem: 'no-fingerprints' };
  const origin = blendVector(averages);
  if (origin === null) return { problem: 'no-fingerprints' };

  const ofParts = heard.flatMap((tracks) => nearestTo(data, origin, tracks)[0] ?? []);
  const inParts = new Set(partTracks.flat().map(({ id }) => id));
  const between = nearestTo(
    data,
    origin,
    owned.filter(({ id, vector }) => vector >= 0 && !inParts.has(id)),
  )[0];
  return fromSeeds(between === undefined ? ofParts : [...ofParts, between], origin);
}

/** One forgotten track picked at random, and what's near it, so the seeds agree with each other. */
function fromForgotten(data: EngineData, owned: readonly StartTrack[], { random, lastPlayed, now }: Context): Outcome {
  const heard = owned.filter(({ vector }) => vector >= 0);
  if (heard.length === 0) return { problem: 'no-fingerprints' };
  const isForgotten = ({ id }: EngineTrack) => (lastPlayed.get(id) ?? -Infinity) < now - FORGOTTEN_AFTER_MS;
  const pool = heard.filter(isForgotten);
  const anchor = pool[Math.floor(random() * pool.length)];
  if (anchor === undefined) return { problem: 'nothing-close' };
  const seeds = nearestTo(data, vectorOf(data, anchor), pool).slice(0, SEEDS).toReversed();
  const avoid = owned.filter((track) => !isForgotten(track)).map(({ id }) => id);
  return fromSeeds(seeds, averageOf(data, seeds), avoid);
}

function fromSurprise(data: EngineData, owned: readonly StartTrack[], random: () => number): Outcome {
  const heard = owned.filter(({ vector }) => vector >= 0);
  const pool = heard.length > 0 ? heard : owned;
  const pick = pool[Math.floor(random() * pool.length)];
  if (pick === undefined) return { problem: 'nothing-close' };
  return fromSeeds([pick], pick.vector >= 0 ? normalized(vectorOf(data, pick)) : null);
}

export function resolveStart(
  data: EngineData,
  tracks: readonly StartTrack[],
  from: RadioStartFrom,
  context: Context,
): Outcome {
  const owned = tracks.filter(({ isMissing }) => !isMissing);
  switch (from.kind) {
    case 'track': {
      const track = owned.find(({ id }) => id === from.trackId);
      if (track === undefined) return { problem: 'nothing-close' };
      return fromSeeds([track], track.vector >= 0 ? normalized(vectorOf(data, track)) : null);
    }
    case 'genre':
      return fromCentre(
        data,
        owned.filter(({ mains }) => mains.includes(from.genre)),
        context.random,
      );
    case 'decade':
      return fromCentre(
        data,
        owned.filter(({ year }) => decadeOf(year) === from.decade),
        context.random,
      );
    case 'blend':
      return fromBlend(data, owned, from.parts);
    case 'forgotten':
      return fromForgotten(data, owned, context);
    case 'surprise':
      return fromSurprise(data, owned, context.random);
  }
}
