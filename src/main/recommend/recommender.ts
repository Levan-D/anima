/*
 * The way to the engine from main. Everything runs in one worker, started the first time it's wanted: 6,000 tracks of
 * 1,280 numbers don't belong on this thread. It holds the library in memory, and reads it again when the library changes.
 */

import { Worker } from 'node:worker_threads';
import type {
  DiscoverDetail,
  DiscoverList,
  RadioStartFrom,
  RadioStartOptions,
  SimilarList,
  Track,
} from '@shared/domain';
import { err, errorText, ok, type Result } from '@shared/result';
import type { Connection } from '@main/db/connection';
import { FINGERPRINT_MODEL } from '@main/fingerprints/model';
import type { HandlerGroup } from '@main/ipc';
import type { Library } from '@main/library/library';
import type { RadioStartAnswer, SuggestAsk } from '@main/playback/queueTopUp';
import type { RecommendRequest } from './engine';

export type RadioStartAsk = {
  from: RadioStartFrom;
  wander: number;
  energy: number;
  count: number;
  maxPerArtist: number;
  randomSeed: number;
};

const LIST_SIZE = 50;
const LIST_MAX_PER_ARTIST = 3;
const SUGGEST_MAX_PER_ARTIST = 2;
const STABLE_SEED = 1;
const MAX_PLAYLIST_SEEDS = 100;
const STOP_GRACE_MS = 2_000;
const CANT_ASK = "Recommendations aren't available right now";

type RequestBase = { id: number; dbPath: string; generation: string };

type Question =
  | { kind: 'similar'; request: RecommendRequest }
  | { kind: 'radioStart'; ask: RadioStartAsk }
  | { kind: 'radioStartOptions' }
  | { kind: 'discover' }
  | { kind: 'discoverDetail'; key: string };

export type WorkerRequest = RequestBase & Question;

export type WorkerReply =
  | { id: number; ok: true; kind: 'similar'; trackIds: number[]; calmPicks: number[]; hasSignals: boolean }
  | { id: number; ok: true; kind: 'radioStart'; answer: RadioStartAnswer }
  | { id: number; ok: true; kind: 'radioStartOptions'; options: RadioStartOptions }
  | { id: number; ok: true; kind: 'discover'; list: DiscoverList }
  | { id: number; ok: true; kind: 'discoverDetail'; detail: DiscoverDetail }
  | { id: number; ok: false; message: string };

/** A worker can't log for itself. */
export type WorkerMessage = WorkerReply | { warning: string };

export type WorkerData = { modelsDir: string };

function createQueries(db: Connection) {
  const items = db.prepare<[number], { trackId: number }>(
    'SELECT track_id AS trackId FROM playlist_items WHERE playlist_id = ? ORDER BY position',
  );
  const recent = db.prepare<[], { id: number }>(
    `SELECT id FROM (
       SELECT t.id FROM play_events e
       JOIN tracks t ON t.id = e.track_id
       JOIN files f ON f.id = t.file_id AND f.missing_since IS NULL
       ORDER BY e.played_at DESC LIMIT 20
     ) ORDER BY RANDOM() LIMIT 1`,
  );
  const owned = db.prepare<[string], { id: number }>(
    `SELECT t.id FROM tracks t
     JOIN files f ON f.id = t.file_id AND f.missing_since IS NULL
     LEFT JOIN fingerprints p
       ON p.audio_hash = f.audio_hash AND p.start_ms = t.start_ms AND p.end_ms = COALESCE(t.end_ms, -1) AND p.model = ?
     ORDER BY p.audio_hash IS NULL, RANDOM() LIMIT 1`,
  );
  return {
    playlistTracks: (playlistId: number) => items.all(playlistId).map(({ trackId }) => trackId),
    recentPlay: () => recent.get()?.id ?? null,
    anyOwned: () => owned.get(FINGERPRINT_MODEL)?.id ?? null,
  };
}

type Deps = {
  library: Pick<Library, 'perConnection' | 'storedInfo' | 'status' | 'tracksByIds'>;
  workerPath: string;
  modelsDir: string;
  log: { warn: (...details: unknown[]) => void };
};

export type Recommender = ReturnType<typeof createRecommender>;

export function createRecommender({ library, workerPath, modelsDir, log }: Deps) {
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
    const started = new Worker(workerPath, { workerData: { modelsDir } satisfies WorkerData });
    started.on('message', (reply: WorkerMessage) => {
      if ('warning' in reply) {
        log.warn(reply.warning);
        return;
      }
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

  async function similar(
    request: RecommendRequest,
  ): Promise<{ trackIds: number[]; calmPicks: number[]; hasSignals: boolean } | null> {
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
      wander: null,
      origin: null,
      energy: null,
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

    /** What radio and Endless add. Empty when there's nothing good enough, and a failure to ask isn't "no data". */
    async suggest({ history, ...ask }: SuggestAsk) {
      const found = await similar({
        ...ask,
        wander: ask.wander ?? null,
        origin: ask.origin ?? null,
        energy: ask.energy === undefined ? null : { ...ask.energy, history: history ?? ask.seeds },
        maxPerArtist: SUGGEST_MAX_PER_ARTIST,
        randomSeed: Date.now() & 0xffffffff,
      });
      return found ?? { trackIds: [], calmPicks: [], hasSignals: true };
    },

    /** Where radio goes from with nothing playing: one of the last few played, or else any owned track with a fingerprint. */
    pickSeed(): number | null {
      const picked = queries(({ recentPlay, anyOwned }) => recentPlay() ?? anyOwned());
      return picked.ok ? picked.value : null;
    },

    /** Works out where a start goes and what follows it, all at once in the worker. */
    async radioStart(from: RadioStartFrom, wander: number, energy: number, count: number): Promise<RadioStartAnswer> {
      const randomSeed = from.kind === 'surprise' && from.randomSeed !== null ? from.randomSeed : Date.now();
      const reply = await ask({
        kind: 'radioStart',
        ask: { from, wander, energy, count, maxPerArtist: SUGGEST_MAX_PER_ARTIST, randomSeed: randomSeed & 0xffffffff },
      });
      if (reply?.ok === true && reply.kind === 'radioStart') return reply.answer;
      if (reply?.ok === false) log.warn('Starting radio failed', reply.message);
      return { problem: 'nothing-close' };
    },

    async radioStartOptions(): Promise<Result<RadioStartOptions>> {
      const reply = await ask({ kind: 'radioStartOptions' });
      if (reply?.ok !== true || reply.kind !== 'radioStartOptions') return err('unexpected', CANT_ASK);
      return ok(reply.options);
    },

    async discover(): Promise<Result<DiscoverList>> {
      const reply = await ask({ kind: 'discover' });
      if (reply?.ok !== true || reply.kind !== 'discover') return err('unexpected', CANT_ASK);
      return ok(reply.list);
    },

    async discoverDetail(key: string): Promise<Result<DiscoverDetail>> {
      const reply = await ask({ kind: 'discoverDetail', key });
      if (reply?.ok !== true || reply.kind !== 'discoverDetail') return err('unexpected', CANT_ASK);
      return ok(reply.detail);
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
    'radio.startOptions': () => recommender.radioStartOptions(),
    'recommend.similarToTrack': ({ trackId }) => recommender.similarToTrack(trackId),
    'recommend.similarToPlaylist': ({ playlistId }) => recommender.similarToPlaylist(playlistId),
    'recommend.discover': () => recommender.discover(),
    'recommend.discoverDetail': ({ key }) => recommender.discoverDetail(key),
  } satisfies HandlerGroup;
}
