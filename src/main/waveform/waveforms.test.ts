/* Real ffmpeg on generated audio for the decode. The database is real too, and the worker is stood in for by the same code. */
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WaveformData } from '@shared/domain';
import type { Connection } from '@main/db/connection';
import type { Library } from '@main/library/library';
import { closeTestDatabase, ffmpeg, FFMPEG, makeTone, openTestDatabase, tempDir } from '@main/library/testFixtures';
import { ok } from '@shared/result';
import { decodePeaks, type DecodeJob } from '@main/waveform/decode';
import { createWaveforms, type WaveformRunner } from '@main/waveform/waveforms';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let fixtures: string;
let tone: string;
let silence: string;
let long: string;

beforeAll(() => {
  fixtures = tempDir('waveform');
  tone = join(fixtures, 'tone.flac');
  silence = join(fixtures, 'silence.flac');
  long = join(fixtures, 'long.flac');
  makeTone(tone, { frequency: 440, seconds: 2 });
  ffmpeg('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '2', silence);
  ffmpeg('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '3600', long);
});

const running = () => new AbortController().signal;

/** The RMS is half the peaks, so a mix-up between the two would show. */
const levels = (...peaks: number[]): WaveformData => ({
  peaks: Uint8Array.from(peaks),
  rms: Uint8Array.from(peaks, (peak) => peak >> 1),
});

describe('decodePeaks', () => {
  it('gets a tone at its level, from start to end, through real ffmpeg', async () => {
    const decoded = await decodePeaks({ ffmpegPath: FFMPEG, path: tone, durationMs: 2_000 }, running());
    expect(decoded?.peaks.length).toBe(2000);
    // ffmpeg's sine source runs at an eighth of full scale.
    const middle = decoded?.peaks[1000] ?? 0;
    expect(Math.abs(middle - 255 / 8)).toBeLessThan(4);
    expect(decoded?.peaks[1990]).toBeGreaterThan(20);
    // And a sine's RMS is its peak over the square root of two.
    expect(Math.abs((decoded?.rms[1000] ?? 0) - middle / Math.SQRT2)).toBeLessThan(2);
  });

  it('gets silence as zeros', async () => {
    const decoded = await decodePeaks({ ffmpegPath: FFMPEG, path: silence, durationMs: 2_000 }, running());
    expect(decoded?.peaks.length).toBe(2000);
    expect(decoded?.peaks.every((peak) => peak === 0)).toBe(true);
    expect(decoded?.rms.every((level) => level === 0)).toBe(true);
  });

  it('is null for a missing file, a bad ffmpeg and a file with no length', async () => {
    const job = { ffmpegPath: FFMPEG, path: tone, durationMs: 2_000 };
    expect(await decodePeaks({ ...job, path: join(fixtures, 'gone.flac') }, running())).toBeNull();
    expect(await decodePeaks({ ...job, ffmpegPath: join(fixtures, 'no-ffmpeg.exe') }, running())).toBeNull();
    expect(await decodePeaks({ ...job, durationMs: 0 }, running())).toBeNull();
  });

  it('kills ffmpeg when it is stopped', async () => {
    const stopping = new AbortController();
    let child: ChildProcess | null = null;
    const watching = ((...args: Parameters<typeof spawn>) => {
      child = spawn(...args);
      return child;
    }) as typeof spawn;

    const decoding = decodePeaks({ ffmpegPath: FFMPEG, path: long, durationMs: 3_600_000 }, stopping.signal, watching);
    stopping.abort();
    expect(await decoding).toBeNull();
    expect((child as ChildProcess | null)?.exitCode).not.toBe(0);
  });
});

describe('createWaveforms', () => {
  const FILE = 1;
  const CUE_FILE = 2;
  const OTHER_FILE = 3;
  const GONE_FILE = 4;
  const TRACK = 10;
  const CUE_TRACK = 21;
  const OTHER_TRACK = 30;
  const GONE_TRACK = 40;

  let db: Connection;
  let jobs: DecodeJob[];
  let cancelled: string[];
  let finishers: Map<string, (data: WaveformData | null) => void>;
  let next: number | null;

  beforeEach(() => {
    const opened = openTestDatabase(tempDir('waveform-db'));
    db = opened.db;
    db.exec(`
      INSERT INTO artists (id, name, sort_name) VALUES (1, 'a', 'a');
      INSERT INTO files (id, rel_path, size_bytes, mtime_ms, codec, duration_ms, scanned_at, missing_since) VALUES
        (${FILE}, 'one.flac', 1, 100, 'flac', 1000, 1, NULL),
        (${CUE_FILE}, 'album.flac', 1, 100, 'flac', 10000, 1, NULL),
        (${OTHER_FILE}, 'other.flac', 1, 100, 'flac', 1000, 1, NULL),
        (${GONE_FILE}, 'gone.flac', 1, 100, 'flac', 1000, 1, 5);
      INSERT INTO tracks (id, file_id, cue_index, start_ms, end_ms, title, sort_title, artist_id) VALUES
        (${TRACK}, ${FILE}, 0, 0, NULL, 't', 't', 1),
        (${CUE_TRACK}, ${CUE_FILE}, 1, 2000, 3000, 't', 't', 1),
        (22, ${CUE_FILE}, 2, 3000, NULL, 't', 't', 1),
        (${OTHER_TRACK}, ${OTHER_FILE}, 0, 0, NULL, 't', 't', 1),
        (${GONE_TRACK}, ${GONE_FILE}, 0, 0, NULL, 't', 't', 1);
    `);
    jobs = [];
    cancelled = [];
    finishers = new Map();
    next = null;
    return () => closeTestDatabase(db);
  });

  const run: WaveformRunner = (job) => {
    jobs.push(job);
    return {
      levels: new Promise((resolve) => finishers.set(job.path, resolve)),
      cancel: () => {
        cancelled.push(job.path);
        finishers.get(job.path)?.(null);
      },
    };
  };

  function waveforms(ffmpegPath: string | null = FFMPEG) {
    const library = {
      perConnection: <Q>(create: (connection: Connection) => Q) => {
        const queries = create(db);
        return <T>(work: (made: Q) => T) => ok(work(queries));
      },
      absolutePath: (trackId: number) => {
        const row = db
          .prepare<[number], { relPath: string }>(
            'SELECT rel_path AS relPath FROM files f JOIN tracks t ON t.file_id = f.id WHERE t.id = ?',
          )
          .get(trackId);
        return row ? row.relPath : null;
      },
      folder: () => 'D:/nowhere',
    } as unknown as Library;
    return createWaveforms({
      library,
      ffmpegPath,
      run,
      nextTrackId: () => next,
      now: () => 1_000,
      log: { warn: () => {} },
    });
  }

  const finish = async (path: string, data: WaveformData | null) => {
    await vi.waitFor(() => expect(finishers.has(path)).toBe(true));
    finishers.get(path)?.(data);
  };

  it('stores on the first get, and the second spawns nothing', async () => {
    const subject = waveforms();
    const first = subject.get(TRACK);
    await finish('one.flac', levels(1, 2, 3));
    expect(await first).toEqual(ok(levels(1, 2, 3)));

    expect(await subject.get(TRACK)).toEqual(ok(levels(1, 2, 3)));
    expect(jobs).toHaveLength(1);
  });

  it('decodes again for a file changed since', async () => {
    const subject = waveforms();
    const first = subject.get(TRACK);
    await finish('one.flac', levels(1));
    await first;

    db.prepare('UPDATE files SET mtime_ms = 2000 WHERE id = ?').run(FILE);
    const second = subject.get(TRACK);
    await finish('one.flac', levels(2));
    expect(await second).toEqual(ok(levels(2)));
    expect(jobs).toHaveLength(2);
  });

  it('kills what is running for a request for another file, and that one gets null', async () => {
    const subject = waveforms();
    const first = subject.get(TRACK);
    const second = subject.get(OTHER_TRACK);
    expect(await first).toEqual(ok(null));
    expect(cancelled).toEqual(['one.flac']);

    await finish('other.flac', levels(9));
    expect(await second).toEqual(ok(levels(9)));
  });

  it('shares what is running with another track of the same file', async () => {
    const subject = waveforms();
    const first = subject.get(CUE_TRACK);
    const second = subject.get(22);
    await finish('album.flac', levels(...Array.from({ length: 100 }, (_, index) => index)));

    expect(cancelled).toEqual([]);
    expect(jobs).toHaveLength(1);
    const part = (await first) as { value: { peaks: Uint8Array } };
    expect([part.value.peaks[0], part.value.peaks.length]).toEqual([20, 10]);
    const rest = (await second) as { value: { peaks: Uint8Array } };
    expect([rest.value.peaks[0], rest.value.peaks.length]).toEqual([30, 70]);
  });

  it('stores the whole file for a CUE track', async () => {
    const subject = waveforms();
    const first = subject.get(CUE_TRACK);
    await finish('album.flac', levels(...new Array<number>(100).fill(0)));
    await first;
    const stored = db
      .prepare<[number], { peaks: Buffer; rms: Buffer }>('SELECT peaks, rms FROM waveforms WHERE file_id = ?')
      .get(CUE_FILE);
    expect(stored?.peaks.length).toBe(100);
    expect(stored?.rms.length).toBe(100);
  });

  it('prepares the next track once the current one is settled, and only then', async () => {
    next = OTHER_TRACK;
    const subject = waveforms();
    const current = subject.get(TRACK);
    await vi.waitFor(() => expect(jobs).toHaveLength(1));
    await finish('one.flac', levels(1));
    await current;
    expect(jobs.map(({ path }) => path)).toEqual(['one.flac', 'other.flac']);

    // Which then becomes current: it's the same decode.
    const becameCurrent = subject.get(OTHER_TRACK);
    await finish('other.flac', levels(2));
    expect(await becameCurrent).toEqual(ok(levels(2)));
    expect(jobs).toHaveLength(2);
    expect(cancelled).toEqual([]);
  });

  it('gives up on the next track when something current comes along', async () => {
    next = OTHER_TRACK;
    const subject = waveforms();
    const current = subject.get(TRACK);
    await finish('one.flac', levels(1));
    await current;

    next = null;
    void subject.get(CUE_TRACK);
    await vi.waitFor(() => expect(cancelled).toEqual(['other.flac']));
    subject.stop();
  });

  it('returns null quietly with no ffmpeg, no such track or a missing file', async () => {
    expect(await waveforms(null).get(TRACK)).toEqual(ok(null));
    expect(await waveforms().get(999)).toEqual(ok(null));
    expect(await waveforms().get(GONE_TRACK)).toEqual(ok(null));
    expect(jobs).toHaveLength(0);
  });

  it('stores nothing when the decode failed', async () => {
    const subject = waveforms();
    const first = subject.get(TRACK);
    await finish('one.flac', null);
    expect(await first).toEqual(ok(null));
    expect(db.prepare('SELECT count(*) AS n FROM waveforms').get()).toEqual({ n: 0 });
  });
});
