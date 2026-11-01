/*
 * The way to the engine from main. Everything runs in one worker, started the first time it's wanted: 6,000 tracks of
 * 1,280 numbers don't belong on this thread. It holds the library in memory, and reads it again when the library changes.
 */

import { Worker } from 'node:worker_threads';
import type { DiscoverList, SimilarList, Track } from '@shared/domain';
import { err, errorText, ok, type Result } from '@shared/result';
import type { Connection } from '@main/db/connection';
import type { HandlerGroup } from '@main/ipc';
import type { Library } from '@main/library/library';
import type { RecommendRequest } from './engine';

const LIST_SIZE = 50;
const LIST_MAX_PER_ARTIST = 3;
const RADIO_COUNT = 3;
const RADIO_MAX_PER_ARTIST = 2;
const RADIO_RECENT_FOR_CAP = 9;
const STABLE_SEED = 1;
const MAX_PLAYLIST_SEEDS = 100;
const STOP_GRACE_MS = 2_000;
const CANT_ASK = "Recommendations aren't available right now";

type RequestBase = { id: number; dbPath: string; generation: string };

type Question = { kind: 'similar'; request: RecommendRequest } | { kind: 'discover' };

export type WorkerRequest = RequestBase & Question;

export type WorkerReply =
  | { id: number; ok: true; kind: 'similar'; trackIds: number[]; hasSignals: boolean }
  | { id: number; ok: true; kind: 'discover'; list: DiscoverList }
  | { id: number; ok: false; message: string };

function createQueries(db: Connection) {
  const items = db.prepare<[number], { trackId: number }>(
    'SELECT track_id AS trackId FROM playlist_items WHERE playlist_id = ? ORDER BY position',
  );
  return { playlistTracks: (playlistId: number) => items.all(playlistId).map(({ trackId }) => trackId) };
}

type Deps = {
  library: Pick<Library, 'perConnection' | 'storedInfo' | 'status' | 'tracksByIds'>;
  workerPath: string;
  log: { warn: (...details: unknown[]) => void };
};

export type Recommender = ReturnType<typeof createRecommender>;

export function createRecommender({ library, workerPath, log }: Deps) {
  const queries = library.perConnection(createQueries);
  const waiting = new Map<number, (reply: WorkerReply) => void>();
  let worker: Worker | null = null;
  let nextId = 1;

  function failAll(message: string): void {
    for (const [id, resolve] of waiting) resolve({ id, ok: false, message });
    waiting.clear();
  }

  function workerNow(): Worker {
    if (worker !== null) return worker;
    const started = new Worker(workerPath);
    started.on('message', (reply: WorkerReply) => {
      waiting.get(reply.id)?.(reply);
      waiting.delete(reply.id);
    });
    started.on('error', (error: unknown) => {
      log.warn('The recommendation worker failed', error);
      failAll(errorText(error));
    });
    started.on('exit', () => {
      if (worker === started) worker = null;
      failAll('The recommendation worker stopped');
    });
    worker = started;
    return started;
  }

  // Anything that changes what's in the database goes through markChanged, so this says when what's held is out of date.
  function ask(question: Question): Promise<WorkerReply | null> {
    const dbPath = library.storedInfo().databasePath;
    const status = library.status();
    if (dbPath === null || status.state !== 'ready') return Promise.resolve(null);
    const id = nextId++;
    const generation = String(status.lastChanged?.at ?? 0);
    return new Promise((resolve) => {
      waiting.set(id, resolve);
      workerNow().postMessage({ ...question, id, dbPath, generation } satisfies WorkerRequest);
    });
  }

  async function similar(request: RecommendRequest): Promise<{ trackIds: number[]; hasSignals: boolean } | null> {
    const reply = await ask({ kind: 'similar', request });
    if (reply?.ok === false) log.warn('Recommending failed', reply.message);
    return reply?.ok === true && reply.kind === 'similar' ? reply : null;
  }

  async function listFor(seeds: number[]): Promise<Result<SimilarList>> {
    const found = await similar({
      seeds,
      exclude: seeds,
      recent: [],
      count: LIST_SIZE,
      maxPerArtist: LIST_MAX_PER_ARTIST,
      randomSeed: STABLE_SEED,
    });
    if (found === null) return err('unexpected', CANT_ASK);
    const tracks = library.tracksByIds(found.trackIds);
    if (!tracks.ok) return tracks;
    const playable: Track[] = tracks.value.filter(({ isMissing }) => !isMissing);
    return ok({ tracks: playable, hasSignals: found.hasSignals });
  }

  return {
    similarToTrack: (trackId: number) => listFor([trackId]),

    async similarToPlaylist(playlistId: number): Promise<Result<SimilarList>> {
      const seeds = queries(({ playlistTracks }) => playlistTracks(playlistId));
      if (!seeds.ok) return seeds;
      if (seeds.value.length === 0) return ok({ tracks: [], hasSignals: true });
      const all = await listFor(seeds.value.slice(-MAX_PLAYLIST_SEEDS));
      if (!all.ok) return all;
      const inIt = new Set(seeds.value);
      return ok({ ...all.value, tracks: all.value.tracks.filter(({ id }) => !inIt.has(id)) });
    },

    /** What the Player tops the queue up with. Empty when there's nothing good enough, or nothing to go on. */
    async forRadio(seeds: number[], recent: number[]): Promise<number[]> {
      const found = await similar({
        seeds,
        exclude: recent,
        recent: recent.slice(-RADIO_RECENT_FOR_CAP),
        count: RADIO_COUNT,
        maxPerArtist: RADIO_MAX_PER_ARTIST,
        randomSeed: Date.now() & 0xffffffff,
      });
      return found?.trackIds ?? [];
    },

    async discover(): Promise<Result<DiscoverList>> {
      const reply = await ask({ kind: 'discover' });
      if (reply?.ok !== true || reply.kind !== 'discover') return err('unexpected', CANT_ASK);
      return ok(reply.list);
    },

    async stop(): Promise<void> {
      const current = worker;
      if (current === null) return;
      worker = null;
      current.postMessage('stop');
      let timer: ReturnType<typeof setTimeout> | undefined;
      const exited = new Promise<void>((resolve) => current.once('exit', () => resolve()));
      const grace = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, STOP_GRACE_MS);
      });
      await Promise.race([exited, grace]);
      clearTimeout(timer);
      await current.terminate();
    },
  };
}

export function recommendHandlers(recommender: Recommender) {
  return {
    'recommend.similarToTrack': ({ trackId }) => recommender.similarToTrack(trackId),
    'recommend.similarToPlaylist': ({ playlistId }) => recommender.similarToPlaylist(playlistId),
    'recommend.discover': () => recommender.discover(),
  } satisfies HandlerGroup;
}
