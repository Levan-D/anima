/*
 * Mood stations in the recommendation worker: the library as the method wants it, the fits, and what's kept of them. Work
 * for a draft that has since changed is cancelled, so the fit threads are always on what was asked last.
 */

import Database from 'better-sqlite3';
import { BUSY_TIMEOUT_MS } from '@main/db/connection';
import { FINGERPRINT_MODEL } from '@main/fingerprints/model';
import {
  MOOD_CHECK_SIZE,
  type MoodCard,
  type MoodDraft,
  type MoodGrade,
  type MoodRule,
  type MoodRuleState,
} from '@shared/stations';
import { createFitPool, type FitHandle } from './fitPool';
import type { HeadScores } from './heads';
import {
  checkKeyOf,
  filterCounts,
  fitKey,
  gradeView,
  passesFilter,
  playableTracks,
  resolveExamples,
  tracksByRow,
  type KeyedExample,
  type MoodFilter,
  type MoodTrack,
  type ResolvedExamples,
} from './moodPool';
import { moodQueries, type MoodFit, type StoredMood } from './moodStore';
import type { EngineData } from './engine';
import { readSungShares, type Snapshot } from './snapshot';
import {
  canBuild,
  gradedExamples,
  gradeStation,
  heldOutFrom,
  leastSure,
  rawScoresOf,
  scoresOf,
  standardize,
  standardizing,
  stationFrom,
  trainingSet,
  unstandardized,
  type StationLibrary,
  type StationRules,
  type StationWeights,
  type Standardizing,
} from './stations';

/** Fits kept in memory, by `fitKey`: enough to go back and forth between a few drafts without fitting again. */
const KEPT_FITS = 16;
const COVERS = 3;

type MoodLibrary = {
  library: StationLibrary;
  scale: Standardizing;
  byRow: (MoodTrack | null)[];
  rules: Record<MoodRule, MoodRuleState>;
};

export type TryAnswer =
  | { problem: 'no-yes' | 'no-fingerprints' | 'superseded' }
  | {
      problem: null;
      songs: number;
      checkIds: number[];
      rules: Record<MoodRule, MoodRuleState>;
      genres: { name: string; songs: number }[];
      decades: { decade: number; songs: number }[];
      grade: MoodGrade | null;
    };

export type MoodAsk = { draft: Omit<MoodDraft, 'name'>; stationId: number | null };

/** What of the worker's snapshot stations use. */
export type MoodSnapshot = Pick<Snapshot, 'fingerprintCount' | 'moodTracks'> & {
  data: Pick<EngineData, 'vectors' | 'dimensions'>;
};

type Deps<S extends MoodSnapshot> = {
  fitWorkerPath: string;
  voiceFor: (snapshot: S) => Promise<HeadScores>;
  energyFor: (snapshot: S) => Promise<HeadScores>;
  /** A station's model, worked out again because its examples name other songs now, for main to keep. */
  onModel: (stationId: number, model: Float64Array, modelOf: string) => void;
};

function readStored<T>(dbPath: string, read: (queries: ReturnType<typeof moodQueries>) => T): T {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: BUSY_TIMEOUT_MS });
  try {
    return read(moodQueries(db));
  } finally {
    db.close();
  }
}

const keyed = (examples: MoodDraft['examples']): KeyedExample[] =>
  examples.map(({ kind, key, isYes }) => ({ kind, key, isYes }));
const filterOf = ({ genre, decade }: Pick<MoodDraft, 'genre' | 'decade'>): MoodFilter => ({ genre, decade });

export function createMoodWork<S extends MoodSnapshot>({ fitWorkerPath, voiceFor, energyFor, onModel }: Deps<S>) {
  const pool = createFitPool(fitWorkerPath);
  const libraries = new WeakMap<S, Promise<MoodLibrary>>();
  /** Raw weights, which hold across snapshots. */
  const fits = new Map<string, StationWeights>();
  const grades = new Map<string, MoodGrade>();
  let current: { key: string; handles: FitHandle[] } | null = null;
  /** The tuner's fits under way, so asking twice for one draft fits it once. */
  const fitting = new Map<string, Promise<StationWeights | null>>();
  const playingNow = new Map<number, { snapshot: S; signature: string; tracks: MoodTrack[] }>();

  function libraryFor(snapshot: S, dbPath: string): Promise<MoodLibrary> {
    const known = libraries.get(snapshot);
    if (known !== undefined) return known;
    const making = (async () => {
      const { vectors, dimensions } = snapshot.data;
      const scale = standardizing(vectors, dimensions);
      const shared = new Float32Array(new SharedArrayBuffer(vectors.byteLength));
      const features = standardize(vectors, dimensions, scale, shared);
      const [voice, energy] = await Promise.all([voiceFor(snapshot), energyFor(snapshot)]);
      const rows = snapshot.fingerprintCount;
      const sung = readSungShares(dbPath, snapshot.moodTracks, rows);
      return {
        library: { features, dimensions, voice: voice.scores, energy: energy.scores, sung },
        scale,
        byRow: tracksByRow(snapshot.moodTracks, rows),
        rules: {
          instrumental: voice.scores === null ? 'unavailable' : 'ready',
          calm: energy.scores === null ? 'unavailable' : 'ready',
          littleSinging: sung.some((share) => !Number.isNaN(share)) ? 'ready' : 'unavailable',
        },
      } satisfies MoodLibrary;
    })();
    making.catch(() => libraries.delete(snapshot));
    libraries.set(snapshot, making);
    return making;
  }

  function keep(key: string, weights: StationWeights): void {
    fits.delete(key);
    fits.set(key, weights);
    for (const old of fits.keys()) {
      if (fits.size <= KEPT_FITS) break;
      fits.delete(old);
    }
  }

  /** Whatever was running for another draft stops: the threads are wanted for this one. */
  function claim(key: string): void {
    if (current !== null && current.key !== key) for (const handle of current.handles) handle.cancel();
    if (current?.key !== key) current = { key, handles: [] };
  }

  function track(key: string, handle: FitHandle): FitHandle {
    claim(key);
    current?.handles.push(handle);
    return handle;
  }

  /** Null if cancelled. Radio's fits aren't the tuner's: neither cancels the other. */
  async function weightsFor(
    mood: MoodLibrary,
    resolved: ResolvedExamples,
    key: string,
    stored: StoredMood | null,
    isRadio = false,
  ): Promise<StationWeights | null> {
    const known = fits.get(key);
    if (known !== undefined) return known;
    const size = mood.library.dimensions + 1;
    if (stored?.modelOf === key && stored.model?.length === size) return stored.model;
    const under = isRadio ? undefined : fitting.get(key);
    if (under !== undefined) return under;
    const handle = pool.fit(mood.library, trainingSet(mood.library, resolved.examples, null));
    const raw = (isRadio ? handle : track(key, handle)).weights.then((fitted) => {
      if (fitted === null) return null;
      const weights = unstandardized(fitted, mood.scale);
      keep(key, weights);
      return weights;
    });
    if (!isRadio) {
      fitting.set(key, raw);
      void raw.finally(() => fitting.delete(key)).catch(() => undefined);
    }
    return raw;
  }

  function storedOf(dbPath: string, stationId: number | null): StoredMood | null {
    return stationId === null ? null : readStored(dbPath, (queries) => queries.get(stationId));
  }

  function knownGrade(key: string, stored: StoredMood | null): MoodGrade | null {
    return grades.get(key) ?? (stored?.modelOf === key ? stored.grade : null);
  }

  function stationOf(
    snapshot: S,
    mood: MoodLibrary,
    resolved: ResolvedExamples,
    rules: StationRules,
    raw: StationWeights,
  ) {
    const { vectors, dimensions } = snapshot.data;
    return stationFrom(mood.library, resolved.examples, rules, rawScoresOf(vectors, dimensions, raw));
  }

  return {
    async tryDraft(
      snapshot: S,
      dbPath: string,
      { draft, stationId }: MoodAsk,
      skipped: readonly number[],
    ): Promise<TryAnswer> {
      if (snapshot.fingerprintCount === 0) return { problem: 'no-fingerprints' };
      const mood = await libraryFor(snapshot, dbPath);
      const resolved = resolveExamples(snapshot.moodTracks, keyed(draft.examples));
      if (!canBuild(resolved.examples)) return { problem: 'no-yes' };
      const key = fitKey(FINGERPRINT_MODEL, resolved);
      claim(key);
      const stored = storedOf(dbPath, stationId);
      const raw = await weightsFor(mood, resolved, key, stored);
      if (raw === null) return { problem: 'superseded' };

      const station = stationOf(snapshot, mood, resolved, draft.rules, raw);
      const filter = filterOf(draft);
      const notAsked = new Set(skipped);
      const asked = leastSure(
        mood.library,
        resolved.examples,
        station,
        (row) => checkKeyOf(mood.byRow[row] ?? null),
        MOOD_CHECK_SIZE,
        (row) => {
          const found = mood.byRow[row];
          return (
            found !== null &&
            found !== undefined &&
            !found.isMissing &&
            !notAsked.has(found.id) &&
            passesFilter(found, filter)
          );
        },
      );
      return {
        problem: null,
        songs: playableTracks(mood.byRow, station.rows, filter).length,
        checkIds: asked.flatMap((row) => mood.byRow[row]?.id ?? []),
        rules: mood.rules,
        ...filterCounts(mood.byRow, station.rows, filter),
        grade: knownGrade(key, stored),
      };
    },

    /** Null if cancelled. `onProgress` hears after each example. */
    async grade(
      snapshot: S,
      dbPath: string,
      { draft, stationId }: MoodAsk,
      onProgress: (done: number, total: number) => void,
    ): Promise<MoodGrade | null> {
      const resolved = resolveExamples(snapshot.moodTracks, keyed(draft.examples));
      const mood = await libraryFor(snapshot, dbPath);
      const indices = gradedExamples(resolved.examples);
      if (indices.filter((index) => resolved.examples[index]?.isYes === true).length < 2) {
        return gradeView(gradeStation(mood.library, resolved.examples, []));
      }
      const key = fitKey(FINGERPRINT_MODEL, resolved);
      claim(key);
      const known = knownGrade(key, storedOf(dbPath, stationId));
      if (known !== null) return known;

      const handles = indices.map((index) =>
        track(key, pool.fit(mood.library, trainingSet(mood.library, resolved.examples, index))),
      );
      const heldOut = [];
      for (const [at, handle] of handles.entries()) {
        const weights = await handle.weights;
        if (weights === null) return null;
        heldOut.push(
          heldOutFrom(mood.library, resolved.examples, indices[at] as number, scoresOf(mood.library, weights)),
        );
        onProgress(at + 1, handles.length);
      }
      const grade = gradeView(gradeStation(mood.library, resolved.examples, heldOut));
      grades.set(key, grade);
      return grade;
    },

    /** What a save keeps. Null without a yes example, or if cancelled. */
    async fitFor(snapshot: S, dbPath: string, { draft, stationId }: MoodAsk): Promise<MoodFit | null> {
      const resolved = resolveExamples(snapshot.moodTracks, keyed(draft.examples));
      if (!canBuild(resolved.examples)) return null;
      const mood = await libraryFor(snapshot, dbPath);
      const key = fitKey(FINGERPRINT_MODEL, resolved);
      const stored = storedOf(dbPath, stationId);
      const model = await weightsFor(mood, resolved, key, stored);
      return model === null ? null : { model, modelOf: key, grade: knownGrade(key, stored) };
    },

    /** What a station plays, on this device. Null when it's gone or has nothing to learn from. Asked at every top-up. */
    async playing(snapshot: S, dbPath: string, stationId: number): Promise<MoodTrack[] | null> {
      const stored = storedOf(dbPath, stationId);
      if (stored === null) return null;
      const resolved = resolveExamples(snapshot.moodTracks, keyed(stored.examples));
      if (!canBuild(resolved.examples)) return null;
      const key = fitKey(FINGERPRINT_MODEL, resolved);
      const signature = JSON.stringify([key, stored.modelOf, stored.rules, stored.genre, stored.decade]);
      const kept = playingNow.get(stationId);
      if (kept?.snapshot === snapshot && kept.signature === signature) return kept.tracks;

      const mood = await libraryFor(snapshot, dbPath);
      const raw = await weightsFor(mood, resolved, key, stored, true);
      if (raw === null) return null;
      if (stored.modelOf !== key) onModel(stationId, raw, key);
      const tracks = playableTracks(
        mood.byRow,
        stationOf(snapshot, mood, resolved, stored.rules, raw).rows,
        filterOf(stored),
      );
      playingNow.set(stationId, { snapshot, signature, tracks });
      return tracks;
    },

    /** Counted with the model each was saved with, so the list never waits on a fit. */
    async cards(snapshot: S, dbPath: string): Promise<MoodCard[]> {
      const stored = readStored(dbPath, (queries) => queries.list());
      const mood = stored.length === 0 || snapshot.fingerprintCount === 0 ? null : await libraryFor(snapshot, dbPath);
      const byId = new Map(snapshot.moodTracks.map((one) => [one.id, one]));
      return stored.map((station) => {
        const resolved = resolveExamples(snapshot.moodTracks, keyed(station.examples));
        const covers = [
          ...new Set(
            resolved.trackIds
              .filter((_, index) => station.examples[index]?.isYes === true)
              .flatMap((ids) => ids.flatMap((id) => byId.get(id)?.artHash ?? []).slice(0, 1)),
          ),
        ].slice(0, COVERS);
        const usable =
          mood !== null && station.model?.length === mood.library.dimensions + 1 && canBuild(resolved.examples);
        const songs =
          !usable || station.model === null
            ? null
            : playableTracks(
                mood.byRow,
                stationOf(snapshot, mood, resolved, station.rules, station.model).rows,
                filterOf(station),
              ).length;
        return { id: station.id, name: station.name, covers, songs };
      });
    },

    stop: () => pool.stop(),
  };
}
