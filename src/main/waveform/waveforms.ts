/*
 * Levels per file, computed once and kept in the database. One decode runs at a time: what's asked for now is what's
 * playing, so it takes over from anything else. Once that's settled, the next track gets its turn.
 */
import { Worker } from 'node:worker_threads';
import type { WaveformData } from '@shared/domain';
import { ok, type Result } from '@shared/result';
import type { Connection } from '@main/db/connection';
import type { HandlerGroup } from '@main/ipc';
import type { Library } from '@main/library/library';
import type { DecodeJob } from '@main/waveform/decode';
import { levelsInRange } from '@main/waveform/peaks';

export type WaveformWorkerEvent = { levels: WaveformData | null };

export type WaveformRun = {
  /** Always resolves. Null when it failed or was cancelled. */
  levels: Promise<WaveformData | null>;
  cancel: () => void;
};

export type WaveformRunner = (job: DecodeJob) => WaveformRun;

export function waveformInWorker(workerPath: string): WaveformRunner {
  return (job) => {
    const worker = new Worker(workerPath, { workerData: job });
    const levels = new Promise<WaveformData | null>((resolve) => {
      worker.once('message', (event: WaveformWorkerEvent) => resolve(event.levels));
      worker.once('error', () => resolve(null));
      worker.once('exit', () => resolve(null));
    });
    return { levels, cancel: () => worker.postMessage('cancel') };
  };
}

type TrackRow = {
  fileId: number;
  startMs: number;
  endMs: number | null;
  fileMs: number;
  isMissing: 0 | 1;
  peaks: Buffer | null;
  rms: Buffer | null;
};

function storedLevels({ peaks, rms }: TrackRow): WaveformData | null {
  return peaks === null || rms === null ? null : { peaks, rms };
}

function createWaveformQueries(db: Connection) {
  // A file changed since its peaks were made has none: a newer date fails this, other audio was dropped by the scan.
  const track = db.prepare<[number], TrackRow>(`
    SELECT t.file_id AS fileId, t.start_ms AS startMs, t.end_ms AS endMs, f.duration_ms AS fileMs,
      f.missing_since IS NOT NULL AS isMissing,
      CASE WHEN w.generated_at >= f.mtime_ms THEN w.peaks END AS peaks,
      CASE WHEN w.generated_at >= f.mtime_ms THEN w.rms END AS rms
    FROM tracks t
    JOIN files f ON f.id = t.file_id
    LEFT JOIN waveforms w ON w.file_id = f.id
    WHERE t.id = ?
  `);
  const save = db.prepare<[number, Buffer, Buffer, number]>(
    'INSERT OR REPLACE INTO waveforms (file_id, peaks, rms, generated_at) VALUES (?, ?, ?, ?)',
  );
  return {
    track: (trackId: number) => track.get(trackId) ?? null,
    save: (fileId: number, { peaks, rms }: WaveformData, at: number) =>
      save.run(
        fileId,
        Buffer.from(peaks.buffer, peaks.byteOffset, peaks.length),
        Buffer.from(rms.buffer, rms.byteOffset, rms.length),
        at,
      ),
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
  let running: { fileId: number; levels: Promise<WaveformData | null>; cancel: () => void } | null = null;

  function save(fileId: number, folder: string | null, levels: WaveformData): void {
    // The ids belong to the library the decode started in.
    if (library.folder() !== folder) return;
    try {
      queries(({ save: write }) => write(fileId, levels, now()));
    } catch (error) {
      log.warn('Could not save a waveform', error);
    }
  }

  function compute(trackId: number, { fileId, fileMs, isMissing }: TrackRow): Promise<WaveformData | null> {
    if (running?.fileId === fileId) return running.levels;

    const path = library.absolutePath(trackId);
    if (ffmpegPath === null || path === null || isMissing) return Promise.resolve(null);

    running?.cancel();
    const folder = library.folder();
    const started = run({ ffmpegPath, path, durationMs: fileMs });
    const job = {
      fileId,
      cancel: started.cancel,
      levels: started.levels.then((levels) => {
        if (running === job) running = null;
        if (levels !== null) save(fileId, folder, levels);
        return levels;
      }),
    };
    running = job;
    return job.levels;
  }

  function prepareNext(): void {
    if (running !== null) return;
    const next = nextTrackId();
    if (next === null) return;
    const found = queries(({ track }) => track(next));
    if (found.ok && found.value !== null && storedLevels(found.value) === null) void compute(next, found.value);
  }

  return {
    /** Resolves once the levels exist. Null means there won't be any, or something else was asked for since. */
    async get(trackId: number): Promise<Result<WaveformData | null>> {
      const found = queries(({ track }) => track(trackId));
      if (!found.ok) return found;
      if (found.value === null) return ok(null);

      const { startMs, endMs, fileMs } = found.value;
      const levels = storedLevels(found.value) ?? (await compute(trackId, found.value));
      prepareNext();
      return ok(levels === null ? null : levelsInRange(levels, fileMs, startMs, endMs));
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
