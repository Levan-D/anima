/*
 * Peaks per file, computed once and kept in the database. One decode runs at a time: what's asked for now is what's
 * playing, so it takes over from anything else. Once that's settled, the next track gets its turn.
 */
import { Worker } from 'node:worker_threads';
import type { WaveformData } from '@shared/domain';
import { ok, type Result } from '@shared/result';
import type { Connection } from '@main/db/connection';
import type { HandlerGroup } from '@main/ipc';
import type { Library } from '@main/library/library';
import type { DecodeJob } from '@main/waveform/decode';
import { peaksInRange } from '@main/waveform/peaks';

export type WaveformWorkerEvent = { peaks: Uint8Array | null };

export type WaveformRun = {
  /** Always resolves. Null when it failed or was cancelled. */
  peaks: Promise<Uint8Array | null>;
  cancel: () => void;
};

export type WaveformRunner = (job: DecodeJob) => WaveformRun;

export function waveformInWorker(workerPath: string): WaveformRunner {
  return (job) => {
    const worker = new Worker(workerPath, { workerData: job });
    const peaks = new Promise<Uint8Array | null>((resolve) => {
      worker.once('message', (event: WaveformWorkerEvent) => resolve(event.peaks));
      worker.once('error', () => resolve(null));
      worker.once('exit', () => resolve(null));
    });
    return { peaks, cancel: () => worker.postMessage('cancel') };
  };
}

type TrackRow = {
  fileId: number;
  startMs: number;
  endMs: number | null;
  fileMs: number;
  isMissing: 0 | 1;
  peaks: Buffer | null;
};

function createWaveformQueries(db: Connection) {
  // The scan leaves this table alone, so a file changed since its peaks were made just doesn't have any.
  const track = db.prepare<[number], TrackRow>(`
    SELECT t.file_id AS fileId, t.start_ms AS startMs, t.end_ms AS endMs, f.duration_ms AS fileMs,
      f.missing_since IS NOT NULL AS isMissing,
      CASE WHEN w.generated_at >= f.mtime_ms THEN w.peaks END AS peaks
    FROM tracks t
    JOIN files f ON f.id = t.file_id
    LEFT JOIN waveforms w ON w.file_id = f.id
    WHERE t.id = ?
  `);
  const save = db.prepare<[number, Buffer, number]>(
    'INSERT OR REPLACE INTO waveforms (file_id, peaks, generated_at) VALUES (?, ?, ?)',
  );
  return {
    track: (trackId: number) => track.get(trackId) ?? null,
    save: (fileId: number, peaks: Uint8Array, at: number) =>
      save.run(fileId, Buffer.from(peaks.buffer, peaks.byteOffset, peaks.length), at),
  };
}

type Deps = {
  library: Pick<Library, 'perConnection' | 'absolutePath' | 'folder'>;
  ffmpegPath: string | null;
  run: WaveformRunner;
  /** What plays after the current track, which is worth having ready by the time it does. */
  nextTrackId: () => number | null;
  now: () => number;
  log: { warn: (...details: unknown[]) => void };
};

export type Waveforms = ReturnType<typeof createWaveforms>;

export function createWaveforms({ library, ffmpegPath, run, nextTrackId, now, log }: Deps) {
  const queries = library.perConnection(createWaveformQueries);
  let running: { fileId: number; peaks: Promise<Uint8Array | null>; cancel: () => void } | null = null;

  function save(fileId: number, folder: string | null, peaks: Uint8Array): void {
    // The ids belong to the library the decode started in.
    if (library.folder() !== folder) return;
    try {
      queries(({ save: write }) => write(fileId, peaks, now()));
    } catch (error) {
      log.warn('Could not save a waveform', error);
    }
  }

  function compute(trackId: number, { fileId, fileMs, isMissing }: TrackRow): Promise<Uint8Array | null> {
    if (running?.fileId === fileId) return running.peaks;

    const path = library.absolutePath(trackId);
    if (ffmpegPath === null || path === null || isMissing) return Promise.resolve(null);

    running?.cancel();
    const folder = library.folder();
    const started = run({ ffmpegPath, path, durationMs: fileMs });
    const job = {
      fileId,
      cancel: started.cancel,
      peaks: started.peaks.then((peaks) => {
        if (running === job) running = null;
        if (peaks !== null) save(fileId, folder, peaks);
        return peaks;
      }),
    };
    running = job;
    return job.peaks;
  }

  function prepareNext(): void {
    if (running !== null) return;
    const next = nextTrackId();
    if (next === null) return;
    const found = queries(({ track }) => track(next));
    if (found.ok && found.value !== null && found.value.peaks === null) void compute(next, found.value);
  }

  return {
    /** Resolves once the peaks exist. Null means there won't be any, or something else was asked for since. */
    async get(trackId: number): Promise<Result<WaveformData | null>> {
      const found = queries(({ track }) => track(trackId));
      if (!found.ok) return found;
      if (found.value === null) return ok(null);

      const { startMs, endMs, fileMs } = found.value;
      const peaks = found.value.peaks ?? (await compute(trackId, found.value));
      prepareNext();
      return ok(peaks === null ? null : { peaks: peaksInRange(peaks, fileMs, startMs, endMs) });
    },

    stop(): void {
      running?.cancel();
      running = null;
    },
  };
}

export function waveformHandlers(waveforms: Waveforms) {
  return {
    'waveform.get': ({ trackId }) => waveforms.get(trackId),
  } satisfies HandlerGroup;
}
