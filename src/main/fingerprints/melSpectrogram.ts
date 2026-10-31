/*
 * What Discogs-EffNet expects as input, built from Essentia's C++ (TensorflowInputMusiCNN, MelBands, TriangularBands,
 * Windowing): 16 kHz mono, frames of 512 hopping 256, a symmetric Hann that isn't normalized, 96 Slaney-warped bands up to
 * 8 kHz, unit_tri, power, then log10(1 + 10000x). Changing any of it changes what every stored vector means: give it a new
 * model id if so.
 */

export const SAMPLE_RATE = 16_000;
export const BANDS = 96;
export const PATCH_FRAMES = 128;
export const EMBEDDING_SIZE = 1280;
export const CHUNK_SECONDS = 30;

const FRAME = 512;
const HOP = 256;
const PATCH_HOP = 62;
const SLANEY_BREAK_HZ = 1000;
const SLANEY_LOW = 3 / 200;
const SLANEY_LOG = Math.log(6.4) / 27;

const hzToMel = (hz: number) =>
  hz < SLANEY_BREAK_HZ ? hz * SLANEY_LOW : 15 + Math.log(hz / SLANEY_BREAK_HZ) / SLANEY_LOG;
const melToHz = (mel: number) => (mel < 15 ? mel / SLANEY_LOW : SLANEY_BREAK_HZ * Math.exp((mel - 15) * SLANEY_LOG));

type Filter = { first: number; weights: Float64Array };

function buildFilters(): Filter[] {
  const top = hzToMel(SAMPLE_RATE / 2);
  const edges = Array.from({ length: BANDS + 2 }, (_, index) => melToHz((top * index) / (BANDS + 1)));
  const binHz = SAMPLE_RATE / FRAME;
  return Array.from({ length: BANDS }, (_, band) => {
    const low = edges[band] ?? 0;
    const middle = edges[band + 1] ?? 0;
    const high = edges[band + 2] ?? 0;
    const area = (high - low) / 2;
    const first = Math.ceil(low / binHz);
    const last = Math.min(Math.floor(high / binHz), FRAME / 2);
    const weights = new Float64Array(last - first + 1);
    for (let bin = first; bin <= last; bin++) {
      const hz = bin * binHz;
      weights[bin - first] = (hz < middle ? (hz - low) / (middle - low) : (high - hz) / (high - middle)) / area;
    }
    return { first, weights };
  });
}

const FILTERS = buildFilters();
const HANN = Float64Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1)));
const BIT_REVERSED = Uint16Array.from({ length: FRAME }, (_, value) => {
  let reversed = 0;
  for (let bit = 0; bit < Math.log2(FRAME); bit++)
    if (value & (1 << bit)) reversed |= 1 << (Math.log2(FRAME) - 1 - bit);
  return reversed;
});
const COS = Float64Array.from({ length: FRAME / 2 }, (_, i) => Math.cos((-2 * Math.PI * i) / FRAME));
const SIN = Float64Array.from({ length: FRAME / 2 }, (_, i) => Math.sin((-2 * Math.PI * i) / FRAME));

const real = new Float64Array(FRAME);
const imaginary = new Float64Array(FRAME);
const power = new Float64Array(FRAME / 2 + 1);

// Typed arrays of a known length, read in a hot loop, so noUncheckedIndexedAccess's checks are asserted away by `as number`.
function powerSpectrum(samples: Float32Array, start: number): void {
  for (let i = 0; i < FRAME; i++) {
    real[BIT_REVERSED[i] as number] = (samples[start + i] as number) * (HANN[i] as number);
    imaginary[i] = 0;
  }
  for (let size = 2; size <= FRAME; size *= 2) {
    const half = size / 2;
    const step = FRAME / size;
    for (let i = 0; i < FRAME; i += size) {
      for (let j = 0; j < half; j++) {
        const turn = j * step;
        const a = i + j;
        const b = a + half;
        const wr = COS[turn] as number;
        const wi = SIN[turn] as number;
        const br = real[b] as number;
        const bi = imaginary[b] as number;
        const tr = br * wr - bi * wi;
        const ti = br * wi + bi * wr;
        real[b] = (real[a] as number) - tr;
        imaginary[b] = (imaginary[a] as number) - ti;
        real[a] = (real[a] as number) + tr;
        imaginary[a] = (imaginary[a] as number) + ti;
      }
    }
  }
  for (let i = 0; i <= FRAME / 2; i++) {
    const re = real[i] as number;
    const im = imaginary[i] as number;
    power[i] = re * re + im * im;
  }
}

/** One row of `BANDS` values per frame. */
export function melFrames(samples: Float32Array): { mel: Float32Array; frames: number } {
  const frames = samples.length < FRAME ? 0 : Math.floor((samples.length - FRAME) / HOP) + 1;
  const mel = new Float32Array(frames * BANDS);
  for (let frame = 0; frame < frames; frame++) {
    powerSpectrum(samples, frame * HOP);
    FILTERS.forEach(({ first, weights }, band) => {
      let energy = 0;
      for (let i = 0; i < weights.length; i++) energy += (power[first + i] as number) * (weights[i] as number);
      mel[frame * BANDS + band] = Math.log10(1 + 10_000 * energy);
    });
  }
  return { mel, frames };
}

/** The model's input: `count` patches of `PATCH_FRAMES` frames, overlapping. None for what's under about 2 seconds. */
export function melPatches(mel: Float32Array, frames: number): { data: Float32Array; count: number } {
  const count = frames < PATCH_FRAMES ? 0 : Math.floor((frames - PATCH_FRAMES) / PATCH_HOP) + 1;
  const data = new Float32Array(count * PATCH_FRAMES * BANDS);
  for (let patch = 0; patch < count; patch++) {
    const from = patch * PATCH_HOP * BANDS;
    data.set(mel.subarray(from, from + PATCH_FRAMES * BANDS), patch * PATCH_FRAMES * BANDS);
  }
  return { data, count };
}

/** Where to listen, in seconds from the start of the track: three stretches around 20, 50 and 80%, fewer if it's short. */
export function chunkStarts(durationSeconds: number): number[] {
  if (durationSeconds <= CHUNK_SECONDS) return [0];
  const starts = [0.2, 0.5, 0.8].map((share) =>
    Math.max(0, Math.min(durationSeconds - CHUNK_SECONDS, durationSeconds * share - CHUNK_SECONDS / 2)),
  );
  return durationSeconds < CHUNK_SECONDS * 3 ? [...new Set(starts.map((start) => Math.round(start)))] : starts;
}

/** Null for a vector with nothing in it, or anything that isn't a number. */
export function unitLength(vector: Float64Array): Float32Array | null {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const length = Math.sqrt(sum);
  if (!Number.isFinite(length) || length === 0) return null;
  return Float32Array.from(vector, (value) => value / length);
}
