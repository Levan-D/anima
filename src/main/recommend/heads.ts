/* Runs published heads over the stored vectors. Class positions are fixed by the hashes fetch-binaries pins. */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { blendEnergy } from './energy';

const RELAXED_FILE = 'mood_relaxed-discogs-effnet-1.onnx';
const AGGRESSIVE_FILE = 'mood_aggressive-discogs-effnet-1.onnx';
const JAMENDO_FILE = 'mtg_jamendo_moodtheme-discogs-effnet-1.onnx';
const VOICE_FILE = 'voice_instrumental-discogs-effnet-1.onnx';

/** `[non_relaxed, relaxed]`. */
const RELAXED_CLASS = 1;
/** `[aggressive, not_aggressive]`: the other way round from relaxed. */
const AGGRESSIVE_CLASS = 0;
const JAMENDO_CLASSES = 56;
/** action, energetic, fast, heavy, powerful, upbeat. */
const JAMENDO_ENERGETIC = [0, 18, 20, 27, 40, 54];
/** calm, meditative, relaxing, slow, soft. */
const JAMENDO_CALM = [5, 32, 41, 46, 47];
/** `[instrumental, voice]`. */
const INSTRUMENTAL_CLASS = 0;
const VOICE_CLASSES = 2;

const THREADS = 2;

export type HeadScores =
  | { status: 'ready'; scores: Float32Array }
  | { status: 'no-models' | 'no-fingerprints'; scores: null }
  | { status: 'failed'; scores: null; problem: string };

function meanOf(row: ArrayLike<number>, start: number, classes: readonly number[]): number {
  let sum = 0;
  for (const at of classes) sum += row[start + at] as number;
  return sum / classes.length;
}

/** Nothing a missing or broken model does can reach radio: it plays as it did without them. */
async function runHeads(
  vectors: Float32Array,
  dimensions: number,
  modelsDir: string,
  files: readonly string[],
  exists: (path: string) => boolean,
  combine: (outputs: ArrayLike<number>[], rows: number) => Float32Array,
): Promise<HeadScores> {
  const rows = dimensions === 0 ? 0 : vectors.length / dimensions;
  if (rows === 0) return { status: 'no-fingerprints', scores: null };
  if (!files.every((file) => exists(join(modelsDir, file)))) return { status: 'no-models', scores: null };
  try {
    // Not imported above, so a machine that can't load the runtime still gets radio.
    const { InferenceSession, Tensor } = await import('onnxruntime-node');
    const outputs: ArrayLike<number>[] = [];
    for (const file of files) {
      const session = await InferenceSession.create(join(modelsDir, file), {
        executionProviders: ['cpu'],
        intraOpNumThreads: THREADS,
      });
      try {
        const [input, output] = [session.inputNames[0] as string, session.outputNames[0] as string];
        const results = await session.run({ [input]: new Tensor('float32', vectors, [rows, dimensions]) });
        outputs.push(results[output]?.data as Float32Array);
      } finally {
        await session.release();
      }
    }
    return { status: 'ready', scores: combine(outputs, rows) };
  } catch (error) {
    return { status: 'failed', scores: null, problem: error instanceof Error ? error.message : String(error) };
  }
}

export function scoreEnergy(
  vectors: Float32Array,
  dimensions: number,
  modelsDir: string,
  exists: (path: string) => boolean = existsSync,
): Promise<HeadScores> {
  return runHeads(
    vectors,
    dimensions,
    modelsDir,
    [RELAXED_FILE, AGGRESSIVE_FILE, JAMENDO_FILE],
    exists,
    ([relaxed = [], aggressive = [], jamendo = []], rows) =>
      blendEnergy([
        Float32Array.from({ length: rows }, (_, row) => 1 - (relaxed[row * 2 + RELAXED_CLASS] as number)),
        Float32Array.from({ length: rows }, (_, row) => aggressive[row * 2 + AGGRESSIVE_CLASS] as number),
        Float32Array.from({ length: rows }, (_, row) => {
          const start = row * JAMENDO_CLASSES;
          return meanOf(jamendo, start, JAMENDO_ENERGETIC) - meanOf(jamendo, start, JAMENDO_CALM);
        }),
      ]),
  );
}

/**
 * Higher as more instrumental, by row. On a stored vector it orders songs but isn't a probability (docs/research/energy.md),
 * so a station's cut comes from its own yes examples, never from 0.5.
 */
export function scoreVoice(
  vectors: Float32Array,
  dimensions: number,
  modelsDir: string,
  exists: (path: string) => boolean = existsSync,
): Promise<HeadScores> {
  return runHeads(vectors, dimensions, modelsDir, [VOICE_FILE], exists, ([voice = []], rows) =>
    Float32Array.from({ length: rows }, (_, row) => voice[row * VOICE_CLASSES + INSTRUMENTAL_CLASS] as number),
  );
}
