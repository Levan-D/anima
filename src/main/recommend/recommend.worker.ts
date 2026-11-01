import { parentPort, workerData } from 'node:worker_threads';
import type { DiscoverList } from '@shared/domain';
import { errorText } from '@shared/result';
import { discoverDetail, discoverList } from './discover';
import { scoreEnergy, type EnergyScores } from './energyHeads';
import { hubScores, pickTracks, seededRandom, type EngineData } from './engine';
import { resolveStart, startOptions } from './radioStart';
import type { WorkerData, WorkerMessage, WorkerReply, WorkerRequest } from './recommender';
import { readLastPlayed, readSnapshot, readTrackLeads, type Snapshot } from './snapshot';

type Held = { dbPath: string; generation: string; snapshot: Snapshot };

let held: Held | null = null;
let discovered: { snapshot: Snapshot; list: DiscoverList } | null = null;
let hubs: { dbPath: string; fingerprintCount: number; scores: Float32Array } | null = null;
const energies = new WeakMap<Snapshot, Promise<EnergyScores>>();
const { modelsDir } = workerData as WorkerData;

function snapshotFor({ dbPath, generation }: WorkerRequest): Snapshot {
  if (held?.dbPath === dbPath && held.generation === generation) return held.snapshot;
  held = null;
  const snapshot = readSnapshot(dbPath);
  held = { dbPath, generation, snapshot };
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
function energyFor(snapshot: Snapshot): Promise<EnergyScores> {
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
      return {
        id: request.id,
        ok: true,
        kind: 'similar',
        ...pickTracks(data, request.request),
        hasSignals: hasSignals(snapshot),
      };
    }
    case 'radioStart': {
      const data = await radioData(request.dbPath, snapshot);
      const { from, wander, energy, count, maxPerArtist, randomSeed } = request.ask;
      const lastPlayed = from.kind === 'forgotten' ? readLastPlayed(request.dbPath) : new Map<number, number>();
      const start = resolveStart(data, snapshot.startTracks, from, {
        random: seededRandom(randomSeed),
        lastPlayed,
        now: Date.now(),
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
      });
      return {
        id: request.id,
        ok: true,
        kind: 'radioStart',
        answer: { first: start.first, ...picks, origin: start.origin, hasSignals: hasSignals(snapshot) },
      };
    }
    case 'radioStartOptions':
      return {
        id: request.id,
        ok: true,
        kind: 'radioStartOptions',
        options: { ...startOptions(snapshot.startTracks), energy: (await energyFor(snapshot)).status },
      };
    case 'discover':
      return { id: request.id, ok: true, kind: 'discover', list: discoverFor(snapshot) };
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
    parentPort?.close();
    return;
  }
  answer(request).then(post, (error: unknown) => {
    held = null;
    const reply: WorkerReply = { id: request.id, ok: false, message: errorText(error) };
    post(reply);
  });
});
