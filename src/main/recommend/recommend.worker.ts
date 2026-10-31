import { parentPort } from 'node:worker_threads';
import { errorText } from '@shared/result';
import { discoverArtists } from './discover';
import { hubScores, recommend } from './engine';
import type { WorkerReply, WorkerRequest } from './recommender';
import { readSnapshot, type Snapshot } from './snapshot';

type Held = { dbPath: string; generation: string; snapshot: Snapshot };

let held: Held | null = null;
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
        hasSignals: snapshot.fingerprintCount > 0 || snapshot.artistRows.length > 0 || snapshot.trackRows.length > 0,
      };
    }
    case 'discover':
      return {
        id: request.id,
        ok: true,
        kind: 'discover',
        artists: discoverArtists(snapshot.artistRows, snapshot.trackRows, snapshot.ownedArtists),
        hasData: snapshot.artistRows.length > 0,
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
