/*
 * The worker's half of the art cache: everything on disk. Reading sources is one at a time, as
 * music-metadata needs, and ffmpeg runs a few at once. On-demand jobs go ahead of the background pass.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseFile, selectCover } from 'music-metadata';
import { errorText } from '@shared/result';
import { exists, fullImagePath, thumbnailPath } from '@main/library/artPaths';
import { dominantColor } from '@main/library/dominantColor';

const FFMPEG_AT_ONCE = 4;
const FFMPEG_TIMEOUT_MS = 30_000;
const THUMB_WIDTH = 512;
const COLOR_SAMPLE_PIXELS = 16;

type ArtSource = {
  kind: 'embedded' | 'folder';
  path: string;
};

export type ArtJob = {
  hash: string;
  mime: string;
  sources: ArtSource[];
};

export type ArtJobResult = {
  hash: string;
  ok: boolean;
  color: string | null;
  message: string | null;
};

async function readSource({ kind, path }: ArtSource): Promise<Uint8Array | null> {
  if (kind === 'folder') return readFile(path);
  const { common } = await parseFile(path);
  return selectCover(common.picture)?.data ?? null;
}

type Options = {
  cacheDir: string;
  ffmpegPath: string | null;
  onDone: (result: ArtJobResult) => void;
};

export type ArtQueue = ReturnType<typeof createArtQueue>;

export function createArtQueue({ cacheDir, ffmpegPath, onDone }: Options) {
  const urgent: ArtJob[] = [];
  const background: ArtJob[] = [];
  const running = new Set<string>();
  const children = new Set<ChildProcess>();
  let pumping = false;
  let ffmpegRunning = 0;
  let stopped = false;

  /** The source has to still hold this exact image: it may have been retagged since the scan. */
  async function writeFullImage({ hash, mime, sources }: ArtJob): Promise<string | null> {
    const target = fullImagePath(cacheDir, hash, mime);
    if (await exists(target)) return target;

    for (const source of sources) {
      try {
        const bytes = await readSource(source);
        if (bytes === null || createHash('sha1').update(bytes).digest('hex') !== hash) continue;
        await mkdir(dirname(target), { recursive: true });
        await writeFile(`${target}.tmp`, bytes);
        await rename(`${target}.tmp`, target);
        return target;
      } catch {
        // The next source may still have it.
      }
    }
    return null;
  }

  /** Thumbnail and color from one ffmpeg run. A failure leaves neither, and thumb falls back to the full image. */
  function runFfmpeg(input: string, hash: string, ffmpeg: string): Promise<string | null> {
    const thumbnail = thumbnailPath(cacheDir, hash);
    const temporary = `${thumbnail}.tmp`;
    return new Promise((resolve) => {
      const child = spawn(
        ffmpeg,
        [
          '-nostdin',
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-i',
          input,
          '-map',
          '0:v:0',
          '-frames:v',
          '1',
          '-vf',
          `scale='min(${THUMB_WIDTH},iw)':-2:flags=lanczos`,
          '-q:v',
          '3',
          '-f',
          'mjpeg',
          temporary,
          '-map',
          '0:v:0',
          '-frames:v',
          '1',
          '-vf',
          `scale=${COLOR_SAMPLE_PIXELS}:${COLOR_SAMPLE_PIXELS}:flags=area`,
          '-pix_fmt',
          'rgb24',
          '-f',
          'rawvideo',
          'pipe:1',
        ],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      children.add(child);

      const timer = setTimeout(() => child.kill(), FFMPEG_TIMEOUT_MS);
      const chunks: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));

      const finish = (color: string | null) => {
        clearTimeout(timer);
        children.delete(child);
        resolve(color);
      };
      child.on('error', () => finish(null));
      child.on('close', (code) => {
        if (code !== 0) {
          finish(null);
          return;
        }
        rename(temporary, thumbnail).then(
          () => finish(dominantColor(Buffer.concat(chunks))),
          () => finish(null),
        );
      });
    });
  }

  function report(result: ArtJobResult): void {
    running.delete(result.hash);
    onDone(result);
  }

  async function finishJob(job: ArtJob, full: string): Promise<void> {
    const color = ffmpegPath === null ? null : await runFfmpeg(full, job.hash, ffmpegPath);
    report({ hash: job.hash, ok: true, color, message: null });
  }

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      while (!stopped && ffmpegRunning < FFMPEG_AT_ONCE) {
        const job = urgent.shift() ?? background.shift();
        if (!job) break;
        running.add(job.hash);

        let full: string | null;
        try {
          full = await writeFullImage(job);
        } catch (error) {
          report({ hash: job.hash, ok: false, color: null, message: errorText(error) });
          continue;
        }
        if (full === null) {
          report({ hash: job.hash, ok: false, color: null, message: 'No source holds this image any more' });
          continue;
        }
        if (stopped) {
          report({ hash: job.hash, ok: false, color: null, message: 'Cancelled' });
          continue;
        }

        ffmpegRunning++;
        void finishJob(job, full).finally(() => {
          ffmpegRunning--;
          void pump();
        });
      }
    } finally {
      pumping = false;
    }
  }

  function dropBackground(): void {
    for (const { hash } of background.splice(0)) {
      onDone({ hash, ok: false, color: null, message: 'Cancelled' });
    }
  }

  return {
    /** A hash that's already on its way isn't started twice: its one answer goes to everyone waiting. */
    push(job: ArtJob, isUrgent: boolean): void {
      const isHere = ({ hash }: ArtJob) => hash === job.hash;
      if (running.has(job.hash) || urgent.some(isHere)) return;
      if (isUrgent) {
        const queued = background.findIndex(isHere);
        if (queued !== -1) background.splice(queued, 1);
        urgent.push(job);
      } else if (!background.some(isHere)) {
        background.push(job);
      }
      void pump();
    },

    dropBackground,

    async stop(): Promise<void> {
      stopped = true;
      for (const { hash } of [...urgent.splice(0), ...background.splice(0)]) {
        onDone({ hash, ok: false, color: null, message: 'Cancelled' });
      }
      for (const child of children) child.kill();
      while (children.size > 0 || pumping) await new Promise((resolve) => setTimeout(resolve, 10));
    },
  };
}
