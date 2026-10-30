import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { selectCover, parseFile } from 'music-metadata';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createArtQueue, type ArtJob, type ArtJobResult, type ArtQueue } from '@main/library/artQueue';
import { fullImagePath, thumbnailPath } from '@main/library/artPaths';
import { FFMPEG, makeImage, makeTone, tempDir } from '@main/library/testFixtures';

// Real files and real ffmpeg, on a machine shared with every other test file.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let fixtures: string;
let bigImage: string;
let smallImage: string;
let embedded: string;
let cacheDir: string;

function sha1(path: string): string {
  return createHash('sha1').update(readFileSync(path)).digest('hex');
}

function imageWidth(path: string): number {
  const { stderr } = (() => {
    try {
      execFileSync(FFMPEG, ['-hide_banner', '-nostdin', '-i', path], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { stderr: '' };
    } catch (error) {
      return { stderr: String((error as { stderr: Buffer }).stderr) };
    }
  })();
  return Number(/, (\d+)x\d+/.exec(stderr)?.[1]);
}

function folderJob(path: string, mime = 'image/png'): ArtJob {
  return { hash: sha1(path), mime, sources: [{ kind: 'folder', path }] };
}

function startQueue(ffmpegPath: string | null = FFMPEG) {
  const results: ArtJobResult[] = [];
  const waiting: (() => void)[] = [];
  const queue: ArtQueue = createArtQueue({
    cacheDir,
    ffmpegPath,
    onDone: (result) => {
      results.push(result);
      for (const resolve of waiting.splice(0)) resolve();
    },
  });
  const until = async (count: number) => {
    while (results.length < count) await new Promise<void>((resolve) => waiting.push(resolve));
  };
  return { queue, results, until };
}

beforeAll(async () => {
  fixtures = tempDir('art-fixtures');
  bigImage = join(fixtures, 'big.png');
  smallImage = join(fixtures, 'small.png');
  makeImage(bigImage, 'red', '1500x1500');
  makeImage(smallImage, 'blue', '100x100');
  embedded = join(fixtures, 'embedded.flac');
  makeTone(embedded, { frequency: 440, picture: bigImage, tags: { title: 'With art' } });
  // The picture has to survive the trip through the file for this to mean anything.
  const { common } = await parseFile(embedded);
  expect(selectCover(common.picture)).not.toBeNull();
});

beforeEach(() => {
  cacheDir = tempDir('art-cache');
});

describe('a job', () => {
  it('writes the full image and a thumbnail, split by the first two hex characters', async () => {
    const { queue, results, until } = startQueue();
    const job = folderJob(bigImage);
    queue.push(job, false);
    await until(1);

    expect(results[0]).toMatchObject({ hash: job.hash, ok: true, message: null });
    const full = fullImagePath(cacheDir, job.hash, job.mime);
    const thumb = thumbnailPath(cacheDir, job.hash);
    expect(full).toBe(join(cacheDir, job.hash.slice(0, 2), `${job.hash}.png`));
    expect(thumb).toBe(join(cacheDir, job.hash.slice(0, 2), `${job.hash}.thumb.jpg`));
    expect(readFileSync(full)).toEqual(readFileSync(bigImage));
    expect(existsSync(thumb)).toBe(true);
    await queue.stop();
  });

  it('makes a thumbnail no wider than 512, and smaller than the image', async () => {
    const { queue, until } = startQueue();
    const job = folderJob(bigImage);
    queue.push(job, false);
    await until(1);
    expect(imageWidth(thumbnailPath(cacheDir, job.hash))).toBe(512);
    await queue.stop();
  });

  it('does not upscale a small image', async () => {
    const { queue, until } = startQueue();
    const job = folderJob(smallImage);
    queue.push(job, false);
    await until(1);
    expect(imageWidth(thumbnailPath(cacheDir, job.hash))).toBe(100);
    await queue.stop();
  });

  it('works out a color from the image', async () => {
    const { queue, results, until } = startQueue();
    queue.push(folderJob(bigImage), false);
    queue.push(folderJob(smallImage), false);
    await until(2);
    const colors = new Map(results.map(({ hash, color }) => [hash, color]));
    // Decoding a little off the exact color is fine: this is an accent, not a measurement.
    expect(colors.get(sha1(bigImage))).toMatch(/^#f[0-9a-f]0[0-9a-f]0[0-9a-f]$/);
    expect(colors.get(sha1(smallImage))).toMatch(/^#0[0-9a-f]0[0-9a-f]f[0-9a-f]$/);
    await queue.stop();
  });

  it('reads embedded art with music-metadata', async () => {
    const { queue, results, until } = startQueue();
    const { common } = await parseFile(embedded);
    const data = selectCover(common.picture)?.data ?? new Uint8Array();
    const hash = createHash('sha1').update(data).digest('hex');

    queue.push({ hash, mime: 'image/png', sources: [{ kind: 'embedded', path: embedded }] }, false);
    await until(1);

    expect(results[0]).toMatchObject({ hash, ok: true });
    expect(new Uint8Array(readFileSync(fullImagePath(cacheDir, hash, 'image/png')))).toEqual(new Uint8Array(data));
    await queue.stop();
  });

  it('leaves no temporary files', async () => {
    const { queue, until } = startQueue();
    const job = folderJob(bigImage);
    queue.push(job, false);
    await until(1);
    expect(existsSync(`${fullImagePath(cacheDir, job.hash, job.mime)}.tmp`)).toBe(false);
    expect(existsSync(`${thumbnailPath(cacheDir, job.hash)}.tmp`)).toBe(false);
    await queue.stop();
  });

  it('does not write the full image again when it is already there', async () => {
    const { queue, until } = startQueue();
    const job = folderJob(smallImage);
    queue.push(job, false);
    await until(1);
    const full = fullImagePath(cacheDir, job.hash, job.mime);
    const { mtimeMs } = statSync(full);
    queue.push(job, false);
    await until(2);
    expect(statSync(full).mtimeMs).toBe(mtimeMs);
    await queue.stop();
  });
});

describe('sources', () => {
  it('fails when no source is there', async () => {
    const { queue, results, until } = startQueue();
    queue.push(
      { hash: 'a'.repeat(40), mime: 'image/png', sources: [{ kind: 'folder', path: join(fixtures, 'nope.png') }] },
      false,
    );
    await until(1);
    expect(results[0]).toMatchObject({ ok: false, color: null, message: expect.any(String) as string });
    await queue.stop();
  });

  it('refuses a source that no longer holds this exact image', async () => {
    const { queue, results, until } = startQueue();
    const changed = join(fixtures, 'changed.png');
    makeImage(changed, 'white');
    const hash = 'b'.repeat(40);
    queue.push({ hash, mime: 'image/png', sources: [{ kind: 'folder', path: changed }] }, false);
    await until(1);
    expect(results[0]).toMatchObject({ ok: false });
    expect(existsSync(fullImagePath(cacheDir, hash, 'image/png'))).toBe(false);
    await queue.stop();
  });

  it('tries the next source', async () => {
    const { queue, results, until } = startQueue();
    const hash = sha1(smallImage);
    queue.push(
      {
        hash,
        mime: 'image/png',
        sources: [
          { kind: 'folder', path: join(fixtures, 'gone.png') },
          { kind: 'embedded', path: join(fixtures, 'gone.flac') },
          { kind: 'folder', path: smallImage },
        ],
      },
      false,
    );
    await until(1);
    expect(results[0]).toMatchObject({ hash, ok: true });
    await queue.stop();
  });
});

describe('ffmpeg', () => {
  it('without it, still writes the full image, with no thumbnail or color', async () => {
    const { queue, results, until } = startQueue(null);
    const job = folderJob(smallImage);
    queue.push(job, false);
    await until(1);
    expect(results[0]).toMatchObject({ ok: true, color: null });
    expect(existsSync(fullImagePath(cacheDir, job.hash, job.mime))).toBe(true);
    expect(existsSync(thumbnailPath(cacheDir, job.hash))).toBe(false);
    await queue.stop();
  });

  it('copes with a path that goes nowhere', async () => {
    const { queue, results, until } = startQueue(join(fixtures, 'no-ffmpeg.exe'));
    const job = folderJob(smallImage);
    queue.push(job, false);
    await until(1);
    expect(results[0]).toMatchObject({ ok: true, color: null });
    await queue.stop();
  });

  it('copes with an image it cannot decode', async () => {
    const { queue, results, until } = startQueue();
    const fake = join(fixtures, 'fake.png');
    writeFileSync(fake, 'not an image');
    const job = folderJob(fake);
    queue.push(job, false);
    await until(1);
    expect(results[0]).toMatchObject({ ok: true, color: null });
    expect(existsSync(fullImagePath(cacheDir, job.hash, job.mime))).toBe(true);
    expect(existsSync(thumbnailPath(cacheDir, job.hash))).toBe(false);
    await queue.stop();
  });
});

describe('the queue', () => {
  const colors = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888'];
  let jobs: ArtJob[];

  beforeAll(() => {
    jobs = colors.map((color, index) => {
      const path = join(fixtures, `queue-${index}.png`);
      makeImage(path, color);
      return folderJob(path);
    });
  });

  it('puts an urgent job ahead of the background', async () => {
    const { queue, results, until } = startQueue(null);
    for (const job of jobs.slice(0, 7)) queue.push(job, false);
    const urgent = jobs[7] as ArtJob;
    queue.push(urgent, true);
    await until(jobs.length);

    const position = results.findIndex(({ hash }) => hash === urgent.hash);
    expect(position).toBeLessThanOrEqual(2);
    await queue.stop();
  });

  it('does not start a job twice, however often it is asked for', async () => {
    const { queue, results, until } = startQueue();
    const job = jobs[0] as ArtJob;
    queue.push(job, false);
    queue.push(job, false);
    queue.push(job, true);
    queue.push(job, true);
    await until(1);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(results).toHaveLength(1);
    await queue.stop();
  });

  it('moves a queued background job up instead of doing it twice', async () => {
    const { queue, results, until } = startQueue(null);
    for (const job of jobs) queue.push(job, false);
    const moved = jobs[6] as ArtJob;
    queue.push(moved, true);
    await until(jobs.length);
    expect(results.filter(({ hash }) => hash === moved.hash)).toHaveLength(1);
    await queue.stop();
  });

  it('can drop the background, answering for every job it drops', async () => {
    const { queue, results, until } = startQueue(null);
    for (const job of jobs) queue.push(job, false);
    queue.dropBackground();
    await until(jobs.length);
    expect(results.filter(({ message }) => message === 'Cancelled').length).toBeGreaterThan(0);
    await queue.stop();
  });

  it('runs at most four ffmpeg at once', async () => {
    const { queue, results, until } = startQueue();
    for (const job of jobs) queue.push(job, false);
    await until(jobs.length);
    expect(results.every(({ ok }) => ok)).toBe(true);
    await queue.stop();
  });

  it('stops, answering for what was left', async () => {
    const { queue, results } = startQueue();
    for (const job of jobs) queue.push(job, false);
    await queue.stop();
    expect(results).toHaveLength(jobs.length);
  });

  it('does not lose the source file when the cache is moved under it', async () => {
    const { queue, until } = startQueue(null);
    const job = jobs[0] as ArtJob;
    queue.push(job, false);
    await until(1);
    const full = fullImagePath(cacheDir, job.hash, job.mime);
    renameSync(full, `${full}.moved`);
    queue.push(job, false);
    await until(2);
    expect(existsSync(full)).toBe(true);
    await queue.stop();
  });
});
