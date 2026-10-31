/* The job itself, in a worker with its own connection. One bad file is counted and skipped, and the next run tries it again. */

import { spawn } from 'node:child_process';
import { constants as osConstants, setPriority } from 'node:os';
import { InferenceSession, Tensor } from 'onnxruntime-node';
import { errorText } from '@shared/result';
import { connect, type Connection } from '@main/db/connection';
import { toAbsolute } from '@main/library/relPath';
import {
  BANDS,
  chunkStarts,
  CHUNK_SECONDS,
  EMBEDDING_SIZE,
  melFrames,
  melPatches,
  PATCH_FRAMES,
  SAMPLE_RATE,
  unitLength,
} from './melSpectrogram';
import { FINGERPRINT_MODEL } from './model';

// 1.2 s a track against 1.0 s at four threads, for under half the cores, so playback and the window don't feel it.
const INFERENCE_THREADS = 2;
const MAX_REPORTED_FAILURES = 20;

export type FingerprintJob = {
  dbPath: string;
  root: string;
  modelPath: string;
  ffmpegPath: string;
  now: number;
};

export type FingerprintEvent =
  | { type: 'progress'; done: number; failed: number; total: number }
  | { type: 'finished'; done: number; failed: number; cancelled: boolean; failures: string[] }
  | { type: 'failed'; message: string };

type WorkRow = {
  hash: string;
  relPath: string;
  startMs: number;
  endMs: number | null;
  fileMs: number;
};

function createStatements(db: Connection) {
  const work = db.prepare<[string], WorkRow>(`
    SELECT f.audio_hash AS hash, f.rel_path AS relPath, t.start_ms AS startMs, t.end_ms AS endMs, f.duration_ms AS fileMs
    FROM tracks t
    JOIN files f ON f.id = t.file_id
    LEFT JOIN fingerprints p
      ON p.audio_hash = f.audio_hash AND p.start_ms = t.start_ms AND p.end_ms = COALESCE(t.end_ms, -1) AND p.model = ?
    WHERE f.missing_since IS NULL AND f.audio_hash IS NOT NULL AND p.audio_hash IS NULL
    GROUP BY f.audio_hash, t.start_ms, t.end_ms
    ORDER BY t.id
  `);
  const save = db.prepare<[string, number, number, string, Buffer, number]>(`
    INSERT OR REPLACE INTO fingerprints (audio_hash, start_ms, end_ms, model, vector, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  return { work, save };
}

function decode(
  ffmpegPath: string,
  path: string,
  startSeconds: number,
  lengthSeconds: number,
  signal: AbortSignal,
): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const args = ['-nostdin', '-v', 'error', '-threads', '1', '-ss', String(startSeconds), '-t', String(lengthSeconds)];
    const child = spawn(
      ffmpegPath,
      [...args, '-i', path, '-map', '0:a:0', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', 'pipe:1'],
      { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, signal },
    );
    try {
      if (child.pid !== undefined) setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL);
    } catch {
      // It may have finished already, and a nicer priority is only a courtesy.
    }
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with ${code}`));
        return;
      }
      const all = Buffer.concat(chunks);
      resolve(new Float32Array(all.buffer.slice(all.byteOffset, all.byteOffset + all.length - (all.length % 4))));
    });
  });
}

async function fingerprintOf(
  session: InferenceSession,
  ffmpegPath: string,
  path: string,
  { startMs, endMs, fileMs }: WorkRow,
  signal: AbortSignal,
): Promise<Float32Array | null> {
  const durationSeconds = ((endMs ?? fileMs) - startMs) / 1000;
  const sum = new Float64Array(EMBEDDING_SIZE);
  let used = 0;
  for (const start of chunkStarts(durationSeconds)) {
    const samples = await decode(
      ffmpegPath,
      path,
      startMs / 1000 + start,
      Math.min(CHUNK_SECONDS, durationSeconds),
      signal,
    );
    const { mel, frames } = melFrames(samples);
    const { data, count } = melPatches(mel, frames);
    if (count === 0) continue;
    const input = new Tensor('float32', data, [count, PATCH_FRAMES, BANDS]);
    const output = await session.run({ melspectrogram: input }, ['embeddings']);
    const embeddings = output.embeddings?.data as Float32Array | undefined;
    if (embeddings === undefined) throw new Error('The model gave no embeddings');
    for (let patch = 0; patch < count; patch++) {
      for (let i = 0; i < EMBEDDING_SIZE; i++) {
        sum[i] = (sum[i] as number) + (embeddings[patch * EMBEDDING_SIZE + i] as number) / count;
      }
    }
    used += 1;
  }
  return used === 0 ? null : unitLength(sum);
}

export async function runFingerprints(
  job: FingerprintJob,
  signal: AbortSignal,
  post: (event: FingerprintEvent) => void,
): Promise<void> {
  const db = connect(job.dbPath);
  try {
    const session = await InferenceSession.create(job.modelPath, {
      executionProviders: ['cpu'],
      intraOpNumThreads: INFERENCE_THREADS,
      interOpNumThreads: 1,
      executionMode: 'sequential',
      graphOptimizationLevel: 'all',
    });
    const { work, save } = createStatements(db);
    const rows = work.all(FINGERPRINT_MODEL);
    let done = 0;
    let failed = 0;
    const failures: string[] = [];
    post({ type: 'progress', done, failed, total: rows.length });

    for (const row of rows) {
      if (signal.aborted) break;
      try {
        const vector = await fingerprintOf(session, job.ffmpegPath, toAbsolute(job.root, row.relPath), row, signal);
        if (vector === null) throw new Error('Too short, or nothing in it');
        const bytes = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
        save.run(row.hash, row.startMs, row.endMs ?? -1, FINGERPRINT_MODEL, bytes, job.now);
        done += 1;
      } catch (error) {
        if (signal.aborted) break;
        failed += 1;
        if (failures.length < MAX_REPORTED_FAILURES) failures.push(`${row.relPath}: ${errorText(error)}`);
      }
      post({ type: 'progress', done, failed, total: rows.length });
    }
    await session.release();
    post({ type: 'finished', done, failed, cancelled: signal.aborted, failures });
  } catch (error) {
    post({ type: 'failed', message: errorText(error) });
  } finally {
    db.close();
  }
}
