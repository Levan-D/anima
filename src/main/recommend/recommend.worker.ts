import { parentPort, workerData } from 'node:worker_threads';
import type { DiscoverList, RadioWithin } from '@shared/domain';
import { errorText } from '@shared/result';
import { discoverDetail, discoverList } from './discover';
import { scoreEnergy, scoreVoice, type HeadScores } from './heads';
import { hubScores, pickTracks, seededRandom, type EngineData, type EngineWithin } from './engine';
import { createMoodWork } from './moodWork';
import { resolveStart, startOptions, type StartFrom } from './radioStart';
import type { WorkerData, WorkerMessage, WorkerReply, WorkerRequest } from './recommender';
import { readLastPlayed, readSnapshot, readTrackLeads, refreshThemes, type Snapshot } from './snapshot';
import { themeContents } from './themes';

type Held = { dbPath: string; generation: string; marks: number; snapshot: Snapshot };

let held: Held | null = null;
let discovered: { snapshot: Snapshot; list: DiscoverList } | null = null;
let hubs: { dbPath: string; fingerprintCount: number; scores: Float32Array } | null = null;
const energies = new WeakMap<Snapshot, Promise<HeadScores>>();
const voices = new WeakMap<Snapshot, Promise<HeadScores>>();
const { modelsDir, fitWorkerPath } = workerData as WorkerData;

function snapshotFor({ dbPath, generation, marks }: WorkerRequest): Snapshot {
  if (held?.dbPath === dbPath && held.generation === generation) {
    if (held.marks !== marks) {
      held.marks = marks;
      refreshThemes(dbPath, held.snapshot);
    }
    return held.snapshot;
  }
  held = null;
  const snapshot = readSnapshot(dbPath);
  held = { dbPath, generation, marks, snapshot };
  return snapshot;
}

/** Takes seconds and hardly moves as tracks come and go, so a new snapshot keeps it until the count of vectors changes. */
function hubsFor(dbPath: string, snapshot: Snapshot): Float32Array {
  const { fingerprintCount, data } = snapshot;
  if (hubs?.dbPath === dbPath && hubs.fingerprintCount === fingerprintCount) return hubs.scores;
  const scores = hubScores(data.vectors, data.dimensions);
  hubs = { dbPath, fingerprintCount, scores };
  return scores;
}

function post(message: WorkerMessage): void {
  parentPort?.postMessage(message);
}

/** Percentiles shift as the library does, so each snapshot works out its own. */
function energyFor(snapshot: Snapshot): Promise<HeadScores> {
  const known = energies.get(snapshot);
  if (known !== undefined) return known;
  const { vectors, dimensions } = snapshot.data;
  const scoring = scoreEnergy(vectors, dimensions, modelsDir).then((scores) => {
    if (scores.status === 'failed') post({ warning: `The energy models failed: ${scores.problem}` });
    return scores;
  });
  energies.set(snapshot, scoring);
  return scoring;
}

/** Only mood stations need it, so it waits until one is asked for. */
function voiceFor(snapshot: Snapshot): Promise<HeadScores> {
  const known = voices.get(snapshot);
  if (known !== undefined) return known;
  const { vectors, dimensions } = snapshot.data;
  const scoring = scoreVoice(vectors, dimensions, modelsDir).then((scores) => {
    if (scores.status === 'failed') post({ warning: `The voice model failed: ${scores.problem}` });
    return scores;
  });
  voices.set(snapshot, scoring);
  return scoring;
}

const moods = createMoodWork({
  fitWorkerPath,
  voiceFor,
  energyFor,
  onModel: (stationId, model, modelOf) => post({ moodModel: { stationId, model, modelOf } }),
});

/** A station that's gone or can't be worked out plays nothing, rather than everything. */
async function engineWithin(
  dbPath: string,
  snapshot: Snapshot,
  within: RadioWithin | null,
): Promise<EngineWithin | null> {
  if (within?.kind !== 'station') return within;
  const playing = await moods.playing(snapshot, dbPath, within.stationId);
  return { kind: 'tracks', trackIds: new Set((playing ?? []).map(({ id }) => id)) };
}

async function radioData(dbPath: string, snapshot: Snapshot): Promise<EngineData> {
  const { scores } = await energyFor(snapshot);
  return { ...snapshot.data, hubs: hubsFor(dbPath, snapshot), energy: scores };
}

function discoverFor(snapshot: Snapshot): DiscoverList {
  if (discovered?.snapshot === snapshot) return discovered.list;
  const { artistRows, trackRows, ownedArtists, profiles } = snapshot;
  const list = discoverList(artistRows, trackRows, ownedArtists, profiles);
  discovered = { snapshot, list };
  return list;
}

function hasSignals({ fingerprintCount, artistRows, trackRows }: Snapshot): boolean {
  return fingerprintCount > 0 || artistRows.length > 0 || trackRows.length > 0;
}

async function answer(request: WorkerRequest): Promise<WorkerReply> {
  const snapshot = snapshotFor(request);
  switch (request.kind) {
    case 'similar': {
      const data =
        request.request.energy === null
          ? { ...snapshot.data, hubs: hubsFor(request.dbPath, snapshot) }
          : await radioData(request.dbPath, snapshot);
      const within = await engineWithin(request.dbPath, snapshot, request.request.within);
      return {
        id: request.id,
        ok: true,
        kind: 'similar',
        ...pickTracks(data, { ...request.request, within }),
        hasSignals: hasSignals(snapshot),
      };
    }
    case 'radioStart': {
      const data = await radioData(request.dbPath, snapshot);
      const { from, wander, energy, count, maxPerArtist, randomSeed, season } = request.ask;
      let within: RadioWithin | null = null;
      if (from.kind === 'genre') within = { kind: 'genre', genre: from.genre };
      if (from.kind === 'station') within = { kind: 'station', stationId: from.stationId };
      const inside = await engineWithin(request.dbPath, snapshot, within);
      const startAt: StartFrom = inside?.kind === 'tracks' ? inside : (from as StartFrom);
      const lastPlayed = from.kind === 'forgotten' ? readLastPlayed(request.dbPath) : new Map<number, number>();
      const start = resolveStart(data, snapshot.startTracks, startAt, {
        random: seededRandom(randomSeed),
        lastPlayed,
        now: Date.now(),
        season,
      });
      if ('problem' in start) return { id: request.id, ok: true, kind: 'radioStart', answer: start };
      const picks = pickTracks(data, {
        seeds: start.seeds,
        exclude: [...start.seeds, ...start.avoid],
        recent: start.seeds.slice(-1),
        count,
        maxPerArtist,
        randomSeed,
        wander,
        origin: start.origin,
        energy: energy.isOn ? { settings: energy, history: [start.first], calm: [] } : null,
        season: season === null ? null : { ...season, asked: start.asked },
        within: inside,
      });
      return {
        id: request.id,
        ok: true,
        kind: 'radioStart',
        answer: {
          first: start.first,
          ...picks,
          origin: start.origin,
          asked: start.asked,
          within,
          hasSignals: hasSignals(snapshot),
        },
      };
    }
    case 'themeContents':
      return { id: request.id, ok: true, kind: 'themeContents', contents: themeContents(snapshot.themed) };
    case 'radioStartOptions':
      return {
        id: request.id,
        ok: true,
        kind: 'radioStartOptions',
        options: { ...startOptions(snapshot.startTracks), energy: (await energyFor(snapshot)).status },
      };
    case 'discover':
      return { id: request.id, ok: true, kind: 'discover', list: discoverFor(snapshot) };
    case 'moodTry':
      return {
        id: request.id,
        ok: true,
        kind: 'moodTry',
        answer: await moods.tryDraft(snapshot, request.dbPath, request.ask, request.skipped),
      };
    case 'moodGrade': {
      const grade = await moods.grade(snapshot, request.dbPath, request.ask, (done, total) =>
        post({ progress: { id: request.id, done, total } }),
      );
      return { id: request.id, ok: true, kind: 'moodGrade', grade };
    }
    case 'moodFit':
      return {
        id: request.id,
        ok: true,
        kind: 'moodFit',
        fit: await moods.fitFor(snapshot, request.dbPath, request.ask),
      };
    case 'moodCards':
      return { id: request.id, ok: true, kind: 'moodCards', cards: await moods.cards(snapshot, request.dbPath) };
    case 'discoverDetail':
      return {
        id: request.id,
        ok: true,
        kind: 'discoverDetail',
        detail: discoverDetail(
          request.key,
          snapshot.artistRows,
          readTrackLeads(request.dbPath, request.key),
          snapshot.ownedSongs,
          snapshot.ownedArtistIds,
          snapshot.profiles,
        ),
      };
  }
}

parentPort?.on('message', (request: WorkerRequest | 'stop') => {
  if (request === 'stop') {
    void moods.stop().finally(() => parentPort?.close());
    return;
  }
  answer(request).then(post, (error: unknown) => {
    held = null;
    const reply: WorkerReply = { id: request.id, ok: false, message: errorText(error) };
    post(reply);
  });
});
