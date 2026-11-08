/*
 * The way to the engine from main. Everything runs in one worker, started the first time it's wanted: 6,000 tracks of
 * 1,280 numbers don't belong on this thread. It holds the library in memory, and reads it again when the library changes.
 */

import { Worker } from 'node:worker_threads';
import type {
  DiscoverDetail,
  DiscoverList,
  RadioEnergy,
  RadioStartFrom,
  RadioStartOptions,
  RadioWithin,
  SimilarList,
  Track,
} from '@shared/domain';
import type { MoodCard, MoodGrade } from '@shared/stations';
import { err, errorText, ok, type Result } from '@shared/result';
import type { Seasons, ThemeContents } from '@shared/themes';
import type { Connection } from '@main/db/connection';
import { FINGERPRINT_MODEL } from '@main/fingerprints/model';
import type { HandlerGroup } from '@main/ipc';
import type { Library } from '@main/library/library';
import type { RadioStartAnswer, SuggestAsk } from '@main/playback/queueTopUp';
import type { RecommendRequest } from './engine';
import type { MoodAsk, TryAnswer } from './moodWork';
import type { MoodFit } from './moodStore';
import { seasonAsk, themeBonus, type SeasonAsk } from './seasons';
import { resolveThemes, type ThemeInput, type ThemeMarkRow } from './themes';

export type RadioStartAsk = {
  from: RadioStartFrom;
  wander: number;
  energy: RadioEnergy;
  season: SeasonAsk | null;
  count: number;
  maxPerArtist: number;
  randomSeed: number;
};

const LIST_SIZE = 50;
const LIST_MAX_PER_ARTIST = 3;
const SUGGEST_MAX_PER_ARTIST = 2;
const STABLE_SEED = 1;
const MAX_PLAYLIST_SEEDS = 100;
/** Tried in turn, for one that isn't out of season. */
const SEED_CANDIDATES = 20;
const STOP_GRACE_MS = 2_000;
const CANT_ASK = "Recommendations aren't available right now";

type RequestBase = {
  id: number;
  dbPath: string;
  generation: string;
  /** Goes up with each theme mark. */
  marks: number;
};

/** As main asks it: a mood station by id, which the worker turns into the tracks it plays. */
export type SimilarRequest = Omit<RecommendRequest, 'within'> & { within: RadioWithin | null };

type Question =
  | { kind: 'similar'; request: SimilarRequest }
  | { kind: 'radioStart'; ask: RadioStartAsk }
  | { kind: 'radioStartOptions' }
  | { kind: 'themeContents' }
  | { kind: 'discover' }
  | { kind: 'discoverDetail'; key: string }
  | { kind: 'moodTry'; ask: MoodAsk; skipped: number[] }
  | { kind: 'moodGrade'; ask: MoodAsk }
  | { kind: 'moodFit'; ask: MoodAsk }
  | { kind: 'moodCards' };

export type WorkerRequest = RequestBase & Question;

export type WorkerReply =
  | { id: number; ok: true; kind: 'similar'; trackIds: number[]; calmPicks: number[]; hasSignals: boolean }
  | { id: number; ok: true; kind: 'radioStart'; answer: RadioStartAnswer }
  | { id: number; ok: true; kind: 'radioStartOptions'; options: RadioStartOptions }
  | { id: number; ok: true; kind: 'themeContents'; contents: ThemeContents }
  | { id: number; ok: true; kind: 'discover'; list: DiscoverList }
  | { id: number; ok: true; kind: 'discoverDetail'; detail: DiscoverDetail }
  | { id: number; ok: true; kind: 'moodTry'; answer: TryAnswer }
  | { id: number; ok: true; kind: 'moodGrade'; grade: MoodGrade | null }
  | { id: number; ok: true; kind: 'moodFit'; fit: MoodFit | null }
  | { id: number; ok: true; kind: 'moodCards'; cards: MoodCard[] }
  | { id: number; ok: false; message: string };

/** A worker can't log or write for itself. */
export type WorkerMessage =
  | WorkerReply
  | { warning: string }
  | { progress: { id: number; done: number; total: number } }
  | { moodModel: { stationId: number; model: Float64Array; modelOf: string } };

export type WorkerData = { modelsDir: string; fitWorkerPath: string };

type ThemeRow = Omit<ThemeInput, 'genres'> & { genres: string | null };

function createQueries(db: Connection) {
  const items = db.prepare<[number], { trackId: number }>(
    'SELECT track_id AS trackId FROM playlist_items WHERE playlist_id = ? ORDER BY position',
  );
  const recent = db.prepare<[number], { id: number }>(
    `SELECT id FROM (
       SELECT t.id FROM play_events e
       JOIN tracks t ON t.id = e.track_id
       JOIN files f ON f.id = t.file_id AND f.missing_since IS NULL
       ORDER BY e.played_at DESC LIMIT 20
     ) ORDER BY RANDOM() LIMIT ?`,
  );
  const owned = db.prepare<[string, number], { id: number }>(
    `SELECT t.id FROM tracks t
     JOIN files f ON f.id = t.file_id AND f.missing_since IS NULL
     LEFT JOIN fingerprints p
       ON p.audio_hash = f.audio_hash AND p.start_ms = t.start_ms AND p.end_ms = COALESCE(t.end_ms, -1) AND p.model = ?
     ORDER BY p.audio_hash IS NULL, RANDOM() LIMIT ?`,
  );
  // Its whole album, since that's what can give a song its theme.
  const albumOf = db.prepare<[number, number], ThemeRow>(
    `SELECT t.id, t.title, a.name AS artist, t.album_id AS albumId, al.title AS albumTitle, aa.name AS albumArtist,
       (SELECT group_concat(g.name, char(31)) FROM track_genres tg JOIN genres g ON g.id = tg.genre_id WHERE tg.track_id = t.id) AS genres
     FROM tracks t
     JOIN artists a ON a.id = t.artist_id
     LEFT JOIN albums al ON al.id = t.album_id
     LEFT JOIN artists aa ON aa.id = al.artist_id
     WHERE t.id = ? OR t.album_id = (SELECT album_id FROM tracks WHERE id = ?)`,
  );
  const marks = db.prepare<[], ThemeMarkRow>('SELECT kind, key, theme FROM theme_marks');
  return {
    playlistTracks: (playlistId: number) => items.all(playlistId).map(({ trackId }) => trackId),
    recentPlays: (limit: number) => recent.all(limit).map(({ id }) => id),
    anyOwned: (limit: number) => owned.all(FINGERPRINT_MODEL, limit).map(({ id }) => id),
    themeOf: (trackId: number) =>
      resolveThemes(
        albumOf
          .all(trackId, trackId)
          .map((row) => ({ ...row, genres: row.genres === null ? [] : row.genres.split('\u001f') })),
        marks.all(),
      ).get(trackId)?.theme ?? null,
  };
}

type Deps = {
  library: Pick<Library, 'perConnection' | 'storedInfo' | 'status' | 'tracksByIds'>;
  workerPath: string;
  fitWorkerPath: string;
  modelsDir: string;
  /** A mood station's model, worked out again in the worker, to keep. */
  onMoodModel: (stationId: number, model: Float64Array, modelOf: string) => void;
  seasons: () => Seasons;
  log: { warn: (...details: unknown[]) => void };
};

export type Recommender = ReturnType<typeof createRecommender>;

export function createRecommender({ library, workerPath, fitWorkerPath, modelsDir, onMoodModel, seasons, log }: Deps) {
  const queries = library.perConnection(createQueries);
  const waiting = new Map<number, (reply: WorkerReply) => void>();
  const progress = new Map<number, (done: number, total: number) => void>();
  let worker: Worker | null = null;
  let nextId = 1;
  let marks = 0;

  function failAll(message: string): void {
    for (const [id, resolve] of waiting) resolve({ id, ok: false, message });
    waiting.clear();
    progress.clear();
  }

  function workerNow(): Worker {
    if (worker !== null) return worker;
    const started = new Worker(workerPath, { workerData: { modelsDir, fitWorkerPath } satisfies WorkerData });
    started.on('message', (reply: WorkerMessage) => {
      if ('warning' in reply) {
        log.warn(reply.warning);
        return;
      }
      if ('progress' in reply) {
        progress.get(reply.progress.id)?.(reply.progress.done, reply.progress.total);
        return;
      }
      if ('moodModel' in reply) {
        const { stationId, model, modelOf } = reply.moodModel;
        onMoodModel(stationId, model, modelOf);
        return;
      }
      waiting.get(reply.id)?.(reply);
      waiting.delete(reply.id);
      progress.delete(reply.id);
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
  function ask(question: Question, onProgress?: (done: number, total: number) => void): Promise<WorkerReply | null> {
    const dbPath = library.storedInfo().databasePath;
    const status = library.status();
    if (dbPath === null || status.state !== 'ready') return Promise.resolve(null);
    const id = nextId++;
    const generation = String(status.lastChanged?.at ?? 0);
    return new Promise((resolve) => {
      waiting.set(id, resolve);
      if (onProgress !== undefined) progress.set(id, onProgress);
      workerNow().postMessage({ ...question, id, dbPath, generation, marks } satisfies WorkerRequest);
    });
  }

  async function similar(
    request: SimilarRequest,
  ): Promise<{ trackIds: number[]; calmPicks: number[]; hasSignals: boolean } | null> {
    const reply = await ask({ kind: 'similar', request });
    if (reply?.ok === false) log.warn('Recommending failed', reply.message);
    return reply?.ok === true && reply.kind === 'similar' ? reply : null;
  }

  async function listFor(seeds: number[], asked: number[] = []): Promise<Result<SimilarList>> {
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
      season: seasonAsk(seasons(), new Date(), asked),
      within: null,
    });
    if (found === null) return err('unexpected', CANT_ASK);
    const tracks = library.tracksByIds(found.trackIds);
    if (!tracks.ok) return tracks;
    const playable: Track[] = tracks.value.filter(({ isMissing }) => !isMissing);
    return ok({ tracks: playable, hasSignals: found.hasSignals });
  }

  return {
    noteThemeMarks(): void {
      marks += 1;
    },

    similarToTrack: (trackId: number) => listFor([trackId], [trackId]),

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
    async suggest({ history, asked, ...ask }: SuggestAsk) {
      const found = await similar({
        ...ask,
        wander: ask.wander ?? null,
        origin: ask.origin ?? null,
        energy: ask.energy === undefined ? null : { ...ask.energy, history: history ?? ask.seeds },
        season: seasonAsk(seasons(), new Date(), asked ?? []),
        within: ask.within ?? null,
        maxPerArtist: SUGGEST_MAX_PER_ARTIST,
        randomSeed: Date.now() & 0xffffffff,
      });
      return found ?? { trackIds: [], calmPicks: [], hasSignals: true };
    },

    /** Where radio goes from with nothing playing: one of the last few played, or else any owned track with a fingerprint. */
    pickSeed(): number | null {
      const bonus = themeBonus(seasonAsk(seasons(), new Date(), []), [], []);
      const picked = queries(({ recentPlays, anyOwned, themeOf }) =>
        [...recentPlays(SEED_CANDIDATES), ...anyOwned(SEED_CANDIDATES)].find((id) => bonus(themeOf(id)) !== null),
      );
      return picked.ok ? (picked.value ?? null) : null;
    },

    /** Works out where a start goes and what follows it, all at once in the worker. */
    async radioStart(from: RadioStartFrom, wander: number, energy: RadioEnergy, count: number): Promise<RadioStartAnswer> {
      const randomSeed = from.kind === 'surprise' && from.randomSeed !== null ? from.randomSeed : Date.now();
      const reply = await ask({
        kind: 'radioStart',
        ask: {
          from,
          wander,
          energy,
          season: seasonAsk(seasons(), new Date(), []),
          count,
          maxPerArtist: SUGGEST_MAX_PER_ARTIST,
          randomSeed: randomSeed & 0xffffffff,
        },
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

    async themeContents(): Promise<Result<ThemeContents>> {
      const reply = await ask({ kind: 'themeContents' });
      if (reply?.ok !== true || reply.kind !== 'themeContents') return err('unexpected', CANT_ASK);
      return ok(reply.contents);
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

    async moodTry(moodAsk: MoodAsk, skipped: number[]): Promise<Result<TryAnswer>> {
      const reply = await ask({ kind: 'moodTry', ask: moodAsk, skipped });
      if (reply?.ok === false) log.warn('Trying a mood station failed', reply.message);
      if (reply?.ok !== true || reply.kind !== 'moodTry') return err('unexpected', CANT_ASK);
      return ok(reply.answer);
    },

    /** Null if a newer ask took its place. */
    async moodGrade(
      moodAsk: MoodAsk,
      onProgress: (done: number, total: number) => void,
    ): Promise<Result<MoodGrade | null>> {
      const reply = await ask({ kind: 'moodGrade', ask: moodAsk }, onProgress);
      if (reply?.ok === false) log.warn('Grading a mood station failed', reply.message);
      if (reply?.ok !== true || reply.kind !== 'moodGrade') return err('unexpected', CANT_ASK);
      return ok(reply.grade);
    },

    async moodFit(moodAsk: MoodAsk): Promise<Result<MoodFit | null>> {
      const reply = await ask({ kind: 'moodFit', ask: moodAsk });
      if (reply?.ok === false) log.warn('Fitting a mood station failed', reply.message);
      if (reply?.ok !== true || reply.kind !== 'moodFit') return err('unexpected', CANT_ASK);
      return ok(reply.fit);
    },

    async moodCards(): Promise<Result<MoodCard[]>> {
      const reply = await ask({ kind: 'moodCards' });
      if (reply?.ok === false) log.warn('Listing mood stations failed', reply.message);
      if (reply?.ok !== true || reply.kind !== 'moodCards') return err('unexpected', CANT_ASK);
      return ok(reply.cards);
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
    'seasons.contents': () => recommender.themeContents(),
    'recommend.similarToTrack': ({ trackId }) => recommender.similarToTrack(trackId),
    'recommend.similarToPlaylist': ({ playlistId }) => recommender.similarToPlaylist(playlistId),
    'recommend.discover': () => recommender.discover(),
    'recommend.discoverDetail': ({ key }) => recommender.discoverDetail(key),
  } satisfies HandlerGroup;
}
