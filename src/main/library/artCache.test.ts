import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createArtCache, type ArtCatalog, type ArtWorkerStarter } from '@main/library/artCache';
import { fullImagePath, thumbnailPath } from '@main/library/artPaths';
import { artInProcess, FFMPEG, makeImage, tempDir } from '@main/library/testFixtures';

// Real files and real ffmpeg, on a machine shared with every other test file.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const log = { warn: vi.fn(), error: vi.fn() };

let fixtures: string;
let image: string;
let otherImage: string;
let imageHash: string;
let otherHash: string;
let cacheDir: string;
let colors: Map<string, string>;

function sha1(path: string): string {
  return createHash('sha1').update(readFileSync(path)).digest('hex');
}

function catalogOf(...images: { hash: string; path: string; color?: string | null }[]): ArtCatalog {
  const byHash = new Map(images.map((entry) => [entry.hash, entry]));
  return {
    mimeOf: (hash) => (byHash.has(hash) ? 'image/png' : null),
    jobFor(hash) {
      const entry = byHash.get(hash);
      return entry ? { hash, mime: 'image/png', sources: [{ kind: 'folder', path: entry.path }] } : null;
    },
    rows: () =>
      images.map(({ hash, color }) => ({ hash, mime: 'image/png', color: colors.get(hash) ?? color ?? null })),
    saveColor: (hash, color) => colors.set(hash, color),
  };
}

function cache(start: ArtWorkerStarter, ffmpegPath: string | null = FFMPEG) {
  return createArtCache({ cacheDir, ffmpegPath, start, log });
}

beforeAll(() => {
  fixtures = tempDir('art-cache-fixtures');
  image = join(fixtures, 'one.png');
  otherImage = join(fixtures, 'two.png');
  makeImage(image, 'teal', '600x600');
  makeImage(otherImage, 'navy', '200x200');
  imageHash = sha1(image);
  otherHash = sha1(otherImage);
});

beforeEach(() => {
  cacheDir = tempDir('art-cache');
  colors = new Map();
  log.warn.mockClear();
  log.error.mockClear();
});

describe('resolve', () => {
  it('never starts the worker for a hash the library does not know', async () => {
    const { start, started } = artInProcess();
    const art = cache(start);
    art.use(catalogOf({ hash: imageHash, path: image }));

    expect(await art.resolve('0123456789abcdef', 'thumb')).toBeNull();
    expect(await art.resolve('0123456789abcdef', 'full')).toBeNull();
    expect(started()).toBe(0);
  });

  it('never starts the worker with no library open', async () => {
    const { start, started } = artInProcess();
    const art = cache(start);
    expect(await art.resolve(imageHash, 'thumb')).toBeNull();
    expect(started()).toBe(0);
  });

  it('on a miss, waits for the worker, and then serves the file', async () => {
    const { start, started } = artInProcess();
    const art = cache(start);
    art.use(catalogOf({ hash: imageHash, path: image }));

    expect(await art.resolve(imageHash, 'thumb')).toEqual({
      path: thumbnailPath(cacheDir, imageHash),
      mime: 'image/jpeg',
    });
    expect(await art.resolve(imageHash, 'full')).toEqual({
      path: fullImagePath(cacheDir, imageHash, 'image/png'),
      mime: 'image/png',
    });
    expect(started()).toBe(1);
    await art.stop();
  });

  it('saves the color it works out', async () => {
    const { start } = artInProcess();
    const art = cache(start);
    art.use(catalogOf({ hash: imageHash, path: image }));
    await art.resolve(imageHash, 'thumb');
    expect(colors.get(imageHash)).toMatch(/^#[0-9a-f]{6}$/);
    await art.stop();
  });

  it('on a hit, does not touch the worker', async () => {
    const first = artInProcess();
    const art = cache(first.start);
    art.use(catalogOf({ hash: imageHash, path: image }));
    await art.resolve(imageHash, 'thumb');
    await art.stop();

    const second = artInProcess();
    const again = cache(second.start);
    again.use(catalogOf({ hash: imageHash, path: image }));
    expect(await again.resolve(imageHash, 'thumb')).toMatchObject({ mime: 'image/jpeg' });
    expect(second.started()).toBe(0);
  });

  it('serves the full image for a thumb when there is no ffmpeg', async () => {
    const { start } = artInProcess();
    const art = cache(start, null);
    art.use(catalogOf({ hash: imageHash, path: image }));
    expect(await art.resolve(imageHash, 'thumb')).toEqual({
      path: fullImagePath(cacheDir, imageHash, 'image/png'),
      mime: 'image/png',
    });
    await art.stop();
  });

  it('serves the full image for a thumb when ffmpeg cannot decode it', async () => {
    const fake = join(fixtures, 'fake.png');
    writeFileSync(fake, 'not an image');
    const hash = sha1(fake);
    const { start } = artInProcess();
    const art = cache(start);
    art.use(catalogOf({ hash, path: fake }));
    expect(await art.resolve(hash, 'thumb')).toMatchObject({ mime: 'image/png' });
    await art.stop();
  });

  it('is null when the source is gone', async () => {
    const { start } = artInProcess();
    const art = cache(start);
    art.use(catalogOf({ hash: 'c'.repeat(40), path: join(fixtures, 'nope.png') }));
    expect(await art.resolve('c'.repeat(40), 'full')).toBeNull();
    expect(log.warn).toHaveBeenCalled();
    await art.stop();
  });

  it('gives up after a while when the worker never answers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const silent: ArtWorkerStarter = () => ({
        post: () => {},
        terminate: () => Promise.resolve(),
        exited: new Promise(() => {}),
      });
      const art = cache(silent);
      art.use(catalogOf({ hash: imageHash, path: image }));
      let answer: unknown = 'still waiting';
      void art.resolve(imageHash, 'full').then((value) => {
        answer = value;
      });
      // Looking on disk first is real I/O, so the timer it's waiting on may not have been set yet.
      while (answer === 'still waiting') {
        await vi.advanceTimersByTimeAsync(5_000);
        await new Promise((resolve) => setImmediate(resolve));
      }
      expect(answer).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks once when many requests come for one image', async () => {
    const posted: unknown[] = [];
    const actual = artInProcess();
    const counting: ArtWorkerStarter = (config, onEvent) => {
      const handle = actual.start(config, onEvent);
      return {
        ...handle,
        post(command) {
          posted.push(command);
          handle.post(command);
        },
      };
    };
    const art = cache(counting);
    art.use(catalogOf({ hash: imageHash, path: image }));
    const answers = await Promise.all([art.resolve(imageHash, 'thumb'), art.resolve(imageHash, 'thumb')]);
    expect(answers[0]).toEqual(answers[1]);
    expect(answers[0]).not.toBeNull();
    expect(posted).toHaveLength(1);
    expect(actual.started()).toBe(1);
    await art.stop();
  });

  it('starts a new worker when the old one died', async () => {
    const { start, started } = artInProcess();
    const art = cache(start);
    art.use(catalogOf({ hash: imageHash, path: image }, { hash: otherHash, path: otherImage }));
    await art.resolve(imageHash, 'thumb');
    await art.stop();
    art.use(catalogOf({ hash: otherHash, path: otherImage }));
    expect(await art.resolve(otherHash, 'thumb')).toMatchObject({ mime: 'image/jpeg' });
    expect(started()).toBe(2);
    await art.stop();
  });
});

describe('runBackgroundPass', () => {
  it('fills the cache, reporting progress', async () => {
    const { start } = artInProcess();
    const art = cache(start);
    art.use(catalogOf({ hash: imageHash, path: image }, { hash: otherHash, path: otherImage }));

    const progress: [number, number][] = [];
    await art.runBackgroundPass((done, total) => progress.push([done, total]));

    expect(progress.at(0)).toEqual([0, 2]);
    expect(progress.at(-1)).toEqual([2, 2]);
    expect(existsSync(thumbnailPath(cacheDir, imageHash))).toBe(true);
    expect(existsSync(thumbnailPath(cacheDir, otherHash))).toBe(true);
    expect(colors.size).toBe(2);
    await art.stop();
  });

  it('starts no worker when everything is there, as on most launches', async () => {
    const first = artInProcess();
    const art = cache(first.start);
    const catalog = catalogOf({ hash: imageHash, path: image });
    art.use(catalog);
    await art.runBackgroundPass();
    await art.stop();

    const second = artInProcess();
    const again = cache(second.start);
    again.use(catalog);
    await again.runBackgroundPass();
    expect(second.started()).toBe(0);
  });

  it('runs again for what is missing, as on a machine that received a copied library', async () => {
    const first = artInProcess();
    const art = cache(first.start);
    const catalog = catalogOf({ hash: imageHash, path: image });
    art.use(catalog);
    await art.runBackgroundPass();
    await art.stop();

    rmSync(thumbnailPath(cacheDir, imageHash));
    const second = artInProcess();
    const again = cache(second.start);
    again.use(catalog);
    await again.runBackgroundPass();
    expect(second.started()).toBe(1);
    expect(existsSync(thumbnailPath(cacheDir, imageHash))).toBe(true);
    await again.stop();
  });

  it('works out a color that was lost', async () => {
    const { start } = artInProcess();
    const art = cache(start);
    const catalog = catalogOf({ hash: imageHash, path: image });
    art.use(catalog);
    await art.runBackgroundPass();
    colors.clear();
    await art.runBackgroundPass();
    expect(colors.get(imageHash)).toMatch(/^#/);
    await art.stop();
  });

  it('without ffmpeg, only the full image counts', async () => {
    const { start, started } = artInProcess();
    const art = cache(start, null);
    art.use(catalogOf({ hash: imageHash, path: image }));
    await art.runBackgroundPass();
    expect(started()).toBe(1);
    await art.stop();

    const second = artInProcess();
    const again = cache(second.start, null);
    again.use(catalogOf({ hash: imageHash, path: image }));
    await again.runBackgroundPass();
    expect(second.started()).toBe(0);
  });

  it('can be stopped, and resolves', async () => {
    const { start } = artInProcess();
    const art = cache(start);
    art.use(catalogOf({ hash: imageHash, path: image }, { hash: otherHash, path: otherImage }));
    const pass = art.runBackgroundPass();
    art.stopBackgroundPass();
    await pass;
    await art.stop();
  });

  it('does nothing with no library', async () => {
    const { start, started } = artInProcess();
    await cache(start).runBackgroundPass();
    expect(started()).toBe(0);
  });

  it('treats a catalog it cannot read as nothing to do', async () => {
    const { start, started } = artInProcess();
    const art = cache(start);
    art.use({ ...catalogOf({ hash: imageHash, path: image }), rows: () => null });
    await art.runBackgroundPass();
    expect(started()).toBe(0);
  });

  it('stops when the library it was working for goes away', async () => {
    const posted: string[] = [];
    const silent: ArtWorkerStarter = () => ({
      post: (command) => posted.push(command.type),
      terminate: () => Promise.resolve(),
      exited: new Promise(() => {}),
    });
    const art = cache(silent);
    art.use(catalogOf({ hash: imageHash, path: image }));
    void art.runBackgroundPass();
    await vi.waitFor(() => expect(posted).toContain('job'));

    art.use(null);
    expect(posted).toContain('drop-background');
  });
});

describe('prune', () => {
  it('removes cache files whose hash has no art row left, and nothing else', async () => {
    const { start } = artInProcess();
    const art = cache(start);
    art.use(catalogOf({ hash: imageHash, path: image }, { hash: otherHash, path: otherImage }));
    await art.runBackgroundPass();

    art.use(catalogOf({ hash: imageHash, path: image }));
    await art.prune();

    expect(existsSync(fullImagePath(cacheDir, imageHash, 'image/png'))).toBe(true);
    expect(existsSync(thumbnailPath(cacheDir, imageHash))).toBe(true);
    expect(existsSync(fullImagePath(cacheDir, otherHash, 'image/png'))).toBe(false);
    expect(existsSync(thumbnailPath(cacheDir, otherHash))).toBe(false);
    await art.stop();
  });

  it('clears leftovers from an interrupted run', async () => {
    const { start } = artInProcess();
    const art = cache(start);
    art.use(catalogOf({ hash: imageHash, path: image }));
    mkdirSync(join(cacheDir, 'ab'), { recursive: true });
    const leftover = join(cacheDir, 'ab', 'abcdef.thumb.jpg.tmp');
    writeFileSync(leftover, '');
    await art.prune();
    expect(existsSync(leftover)).toBe(false);
  });

  it('is fine with no cache folder yet', async () => {
    const { start } = artInProcess();
    const art = createArtCache({ cacheDir: join(cacheDir, 'not-yet'), ffmpegPath: FFMPEG, start, log });
    art.use(catalogOf({ hash: imageHash, path: image }));
    await art.prune();
  });

  describe('keeps everything', () => {
    async function filledCache() {
      const { start } = artInProcess();
      const art = cache(start);
      art.use(catalogOf({ hash: imageHash, path: image }));
      await art.runBackgroundPass();
      return art;
    }

    it('for a library with no art at all, which is more likely the wrong folder', async () => {
      const art = await filledCache();
      art.use(catalogOf());
      await art.prune();
      expect(existsSync(thumbnailPath(cacheDir, imageHash))).toBe(true);
      await art.stop();
    });

    it('when the rows cannot be read, which does not mean there are none', async () => {
      const art = await filledCache();
      art.use({ ...catalogOf(), rows: () => null });
      await art.prune();
      expect(existsSync(thumbnailPath(cacheDir, imageHash))).toBe(true);
      await art.stop();
    });
  });
});

describe('sizeBytes', () => {
  it('adds up the cache', async () => {
    const { start } = artInProcess();
    const art = cache(start);
    expect(await art.sizeBytes()).toBe(0);
    art.use(catalogOf({ hash: imageHash, path: image }));
    await art.resolve(imageHash, 'full');
    expect(await art.sizeBytes()).toBeGreaterThanOrEqual(readFileSync(image).length);
    await art.stop();
  });
});
