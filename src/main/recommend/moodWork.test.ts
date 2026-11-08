/* With the real fit threads, bundled as electron-vite would, over a small made-up library and a real database. */
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Connection } from '@main/db/connection';
import { FINGERPRINT_MODEL } from '@main/fingerprints/model';
import { closeTestDatabase, openTestDatabase, tempDir, TEST_ROOT } from '@main/library/testFixtures';
import type { MoodDraft, MoodExample } from '@shared/stations';
import type { HeadScores } from './heads';
import { fitKey, resolveExamples, type MoodTrack } from './moodPool';
import { moodQueries } from './moodStore';
import { createMoodWork, type MoodSnapshot } from './moodWork';

const BUNDLE = join(TEST_ROOT, 'mood-work-bundle');
const D = 16;
const TRACKS = 300;

beforeAll(async () => {
  await build({
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: { '@main': resolve('src/main'), '@shared': resolve('src/shared') } },
    build: {
      ssr: resolve('src/main/recommend/fit.worker.ts'),
      outDir: BUNDLE,
      emptyOutDir: true,
      rolldownOptions: { output: { entryFileNames: 'fit.worker.js' } },
    },
  });
}, 60_000);

/** Artists of 30 songs, albums of 10. Artists 0 and 1 sound alike, artist 2 sounds like something else. */
function makeSnapshot(): MoodSnapshot {
  let state = 11;
  const next = () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 4294967296 - 0.5;
  };
  const vectors = Float32Array.from({ length: TRACKS * D }, (_, at) => {
    const artist = Math.floor(at / D / 30);
    const lean = (artist <= 1 && at % D === 0) || (artist === 2 && at % D === 1) ? 3 : 0;
    return next() + lean;
  });
  const moodTracks = Array.from({ length: TRACKS }, (_, row): MoodTrack => ({
    id: row + 1,
    row,
    isMissing: row === 5,
    trackKey: `artist ${Math.floor(row / 30)}\tsong ${row}`,
    albumKey: `artist ${Math.floor(row / 30)}\talbum ${Math.floor(row / 10)}`,
    artistKey: `artist ${Math.floor(row / 30)}`,
    mains: [row < 150 ? 'Jazz' : 'Rock'],
    year: 1990 + (row % 20),
    artHash: `art${Math.floor(row / 10)}`,
  }));
  return { data: { vectors, dimensions: D }, fingerprintCount: TRACKS, moodTracks };
}

const artist = (n: number, isYes: boolean): MoodExample => ({
  kind: 'artist',
  key: `artist ${n}`,
  label: `Artist ${n}`,
  isYes,
  source: 'picked',
});
const RULES = { instrumental: false, calm: false, littleSinging: false };
const draftOf = (examples: MoodExample[]): Omit<MoodDraft, 'name'> => ({
  examples,
  rules: RULES,
  genre: null,
  decade: null,
});
const STUDY = draftOf([artist(0, true), artist(1, true), artist(2, false)]);
const NO_MODELS: HeadScores = { status: 'no-models', scores: null };

let db: Connection;
let dbPath: string;
let snapshot: MoodSnapshot;
let models: { stationId: number; modelOf: string }[];
let work: ReturnType<typeof createMoodWork<MoodSnapshot>>;

beforeEach(() => {
  ({ db, dbPath } = openTestDatabase(tempDir('mood-work')));
  snapshot = makeSnapshot();
  models = [];
  work = createMoodWork<MoodSnapshot>({
    fitWorkerPath: join(BUNDLE, 'fit.worker.js'),
    voiceFor: () => Promise.resolve({ status: 'ready', scores: new Float32Array(TRACKS).fill(0.9) }),
    energyFor: () => Promise.resolve(NO_MODELS),
    onModel: (stationId, _model, modelOf) => models.push({ stationId, modelOf }),
  });
});

afterEach(async () => {
  await work.stop();
  closeTestDatabase(db);
});

describe('trying a draft', () => {
  it('needs fingerprints, and a yes example with songs', async () => {
    expect(
      await work.tryDraft({ ...snapshot, fingerprintCount: 0 }, dbPath, { draft: STUDY, stationId: null }, []),
    ).toEqual({
      problem: 'no-fingerprints',
    });
    const noYes = draftOf([artist(2, false), artist(40, true)]);
    expect(await work.tryDraft(snapshot, dbPath, { draft: noYes, stationId: null }, [])).toEqual({ problem: 'no-yes' });
  });

  it('says what it plays, what each filter would leave, and asks about one song an album', async () => {
    const tried = await work.tryDraft(snapshot, dbPath, { draft: STUDY, stationId: null }, [100]);
    if (tried.problem !== null) throw new Error(tried.problem);
    // The 59 yes songs on this device and the top tenth of the 240 unmarked.
    expect(tried.songs).toBeGreaterThanOrEqual(59);
    expect(tried.songs).toBeLessThanOrEqual(59 + 24);
    expect(tried.rules).toEqual({ instrumental: 'ready', calm: 'unavailable', littleSinging: 'unavailable' });
    expect(tried.genres.reduce((sum, { songs }) => sum + songs, 0)).toBe(tried.songs);
    expect(tried.checkIds.length).toBeGreaterThan(0);
    expect(tried.checkIds.every((id) => id > 90 && id !== 100)).toBe(true);
    expect(new Set(tried.checkIds.map((id) => Math.floor((id - 1) / 10))).size).toBe(tried.checkIds.length);
    expect(tried.grade).toBeNull();
  });

  it('answers the same draft asked for twice at once, both times', async () => {
    const asks = [0, 1].map(() => work.tryDraft(snapshot, dbPath, { draft: STUDY, stationId: null }, []));
    const [first, second] = await Promise.all(asks);
    expect(first?.problem).toBeNull();
    expect(second).toEqual(first);
  });

  it('gives way to a newer draft', async () => {
    const older = work.tryDraft(snapshot, dbPath, { draft: STUDY, stationId: null }, []);
    const newer = work.tryDraft(snapshot, dbPath, { draft: draftOf([artist(0, true)]), stationId: null }, []);
    expect(await older).toEqual({ problem: 'superseded' });
    expect((await newer).problem).toBeNull();
  });
});

describe('grading', () => {
  it('hides each album, artist and genre example in turn, saying how far it has got, and remembers the grade', async () => {
    const progress: [number, number][] = [];
    const grade = await work.grade(snapshot, dbPath, { draft: STUDY, stationId: null }, (done, total) =>
      progress.push([done, total]),
    );
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    expect(grade?.kind).toBe('clear');
    expect(grade?.examples.map(({ index }) => index)).toEqual([0, 1, 2]);
    const tried = await work.tryDraft(snapshot, dbPath, { draft: STUDY, stationId: null }, []);
    expect(tried.problem === null && tried.grade).toEqual(grade);
  });

  it('needs two yes examples to hide', async () => {
    const grade = await work.grade(snapshot, dbPath, { draft: draftOf([artist(0, true)]), stationId: null }, () => {
      throw new Error('no fits to report');
    });
    expect(grade?.kind).toBe('too-few');
  });
});

describe('a saved station', () => {
  async function save(draft: Omit<MoodDraft, 'name'>, modelOf: string | null = null): Promise<number> {
    const fit = await work.fitFor(snapshot, dbPath, { draft, stationId: null });
    if (fit === null) throw new Error('no fit');
    return moodQueries(db).create({ ...draft, name: 'Study' }, modelOf === null ? fit : { ...fit, modelOf }, 1);
  }

  it('plays what the draft did, from the model it was saved with', async () => {
    const tried = await work.tryDraft(snapshot, dbPath, { draft: STUDY, stationId: null }, []);
    const stationId = await save(STUDY);
    const playing = await work.playing(snapshot, dbPath, stationId);
    expect(playing?.length).toBe(tried.problem === null ? tried.songs : -1);
    expect(playing?.some(({ id }) => id === 6)).toBe(false);
    expect(models).toEqual([]);
    expect(await work.cards(snapshot, dbPath)).toEqual([
      { id: stationId, name: 'Study', covers: ['art0', 'art3'], songs: playing?.length },
    ]);
  });

  it('works its model out again, for main to keep, when its examples name other songs', async () => {
    const stationId = await save(STUDY, 'from before');
    expect(await work.playing(snapshot, dbPath, stationId)).not.toBeNull();
    const key = fitKey(FINGERPRINT_MODEL, resolveExamples(snapshot.moodTracks, STUDY.examples));
    expect(models).toEqual([{ stationId, modelOf: key }]);
  });

  it('keeps to its filter, and plays nothing once it’s gone', async () => {
    const stationId = await save({ ...STUDY, genre: 'Rock' });
    expect(await work.playing(snapshot, dbPath, stationId)).toSatisfy((tracks: MoodTrack[] | null) =>
      (tracks ?? []).every(({ mains }) => mains.includes('Rock')),
    );
    moodQueries(db).remove(stationId);
    expect(await work.playing(snapshot, dbPath, stationId)).toBeNull();
  });
});
