import { parentPort } from 'node:worker_threads';
import type { DiscoverList } from '@shared/domain';
import { errorText } from '@shared/result';
import { discoverDetail, discoverList } from './discover';
import { hubScores, recommend, seededRandom } from './engine';
import { resolveStart, startOptions } from './radioStart';
import type { WorkerReply, WorkerRequest } from './recommender';
import { readLastPlayed, readSnapshot, readTrackLeads, type Snapshot } from './snapshot';

type Held = { dbPath: string; generation: string; snapshot: Snapshot };

let held: Held | null = null;
let discovered: { snapshot: Snapshot; list: DiscoverList } | null = null;
let hubs: { dbPath: string; fingerprintCount: number; scores: Float32Array } | null = null;

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

function answer(request: WorkerRequest): WorkerReply {
  const snapshot = snapshotFor(request);
  switch (request.kind) {
    case 'similar': {
      const data = { ...snapshot.data, hubs: hubsFor(request.dbPath, snapshot) };
      return {
        id: request.id,
        ok: true,
        kind: 'similar',
        trackIds: recommend(data, request.request),
        hasSignals: hasSignals(snapshot),
      };
    }
    case 'radioStart': {
      const data = { ...snapshot.data, hubs: hubsFor(request.dbPath, snapshot) };
      const { from, wander, count, maxPerArtist, randomSeed } = request.ask;
      const lastPlayed = from.kind === 'forgotten' ? readLastPlayed(request.dbPath) : new Map<number, number>();
      const start = resolveStart(data, snapshot.startTracks, from, {
        random: seededRandom(randomSeed),
        lastPlayed,
        now: Date.now(),
      });
      if ('problem' in start) return { id: request.id, ok: true, kind: 'radioStart', answer: start };
      const trackIds = recommend(data, {
        seeds: start.seeds,
        exclude: [...start.seeds, ...start.avoid],
        recent: start.seeds.slice(-1),
        count,
        maxPerArtist,
        randomSeed,
        wander,
        origin: start.origin,
      });
      return {
        id: request.id,
        ok: true,
        kind: 'radioStart',
        answer: { first: start.first, trackIds, origin: start.origin, hasSignals: hasSignals(snapshot) },
      };
    }
    case 'radioStartOptions':
      return {
        id: request.id,
        ok: true,
        kind: 'radioStartOptions',
        options: startOptions(snapshot.startTracks),
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
  try {
    parentPort?.postMessage(answer(request));
  } catch (error) {
    held = null;
    const reply: WorkerReply = { id: request.id, ok: false, message: errorText(error) };
    parentPort?.postMessage(reply);
  }
});
