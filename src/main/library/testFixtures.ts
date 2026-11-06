/* Generated audio and images for tests, made with ffmpeg at test time. Everything stays under .dev/test-tmp. */

import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { afterAll } from 'vitest';
import { connect, type Connection } from '@main/db/connection';
import { runMaintenance, type MaintenanceRunner } from '@main/db/maintenance';
import { closeCleanly, openDatabase } from '@main/db/open';
import type { ArtWorkerStarter } from '@main/library/artCache';
import { createArtQueue } from '@main/library/artQueue';
import { runScan, type ScanDeps, type ScanOutcome } from '@main/library/scan';
import type { ScanRunner } from '@main/library/scanner';
import { resolveBinaries } from '@main/system/binaries';

export const TEST_ROOT = resolve('.dev/test-tmp');
export const FFMPEG = resolveBinaries({ isPackaged: false, resourcesPath: '', appRoot: process.cwd() }).ffmpeg.path;

const FIXTURES_VERSION = 'fixtures-v2';

const created: string[] = [];

/** A new, empty folder for one test, removed when its test file is done. */
export function tempDir(label: string): string {
  const dir = join(TEST_ROOT, `${label}-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  created.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of created.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Something still has a file open. It's only test output, inside .dev.
    }
  }
});

export function ffmpeg(...args: string[]): void {
  execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-nostdin', ...args], {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

export function makeImage(path: string, color: string, size = '64x64'): void {
  mkdirSync(dirname(path), { recursive: true });
  ffmpeg('-f', 'lavfi', '-i', `color=c=${color}:s=${size}`, '-frames:v', '1', path);
}

type ToneOptions = {
  frequency: number;
  seconds?: number;
  tags?: Record<string, string>;
  picture?: string;
};

function tagArgs(tags: Record<string, string>): string[] {
  return Object.entries(tags).flatMap(([key, value]) => ['-metadata', `${key}=${value}`]);
}

function pictureArgs(picture: string | undefined): string[] {
  return picture ? ['-map', '1:v', '-c:v', 'copy', '-disposition:v', 'attached_pic'] : [];
}

/** The format follows the extension. A different frequency makes a different recording. */
export function makeTone(path: string, { frequency, seconds = 0.4, tags = {}, picture }: ToneOptions): void {
  mkdirSync(dirname(path), { recursive: true });
  ffmpeg(
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${frequency}:duration=${seconds}`,
    ...(picture ? ['-i', picture] : []),
    '-map',
    '0:a',
    ...pictureArgs(picture),
    ...(extname(path) === '.mp3' ? ['-id3v2_version', '3'] : []),
    ...tagArgs(tags),
    path,
  );
}

/** The same audio with other tags, written over the file: what retagging in foobar does. */
export function retag(path: string, tags: Record<string, string>): void {
  const temp = `${path}.retag${extname(path)}`;
  ffmpeg(
    '-i',
    path,
    '-map',
    '0',
    '-c',
    'copy',
    '-map_metadata',
    '-1',
    ...(extname(path) === '.mp3' ? ['-id3v2_version', '3'] : []),
    ...tagArgs(tags),
    temp,
  );
  renameSync(temp, path);
  const later = new Date(statSync(path).mtimeMs + 5000);
  utimesSync(path, later, later);
}

/**
 * A small library with everything a scan has to tell apart. The tones are generated once per
 * version of this list, because ffmpeg takes a moment to start.
 */
export function baseLibrary(): string {
  const base = join(TEST_ROOT, FIXTURES_VERSION);
  if (existsSync(base)) return base;

  const building = tempDir('building');
  const red = join(building, 'red.png');
  const blue = join(building, 'blue.png');
  makeImage(red, 'red', '800x800');
  makeImage(blue, 'blue', '300x300');

  const first = { artist: 'Artist One', album: 'Album A', date: '2001' };
  makeTone(join(building, 'lib', 'Artist One', 'Album A', '01 First.flac'), {
    frequency: 220,
    picture: red,
    tags: { ...first, title: 'First', track: '1', genre: 'Rock;Pop' },
  });
  makeTone(join(building, 'lib', 'Artist One', 'Album A', '02 Second.flac'), {
    frequency: 247,
    picture: red,
    tags: { ...first, title: 'Second', track: '2', genre: 'rock' },
  });

  const second = { artist: 'Artist One', album: 'Album B', date: '1999' };
  makeTone(join(building, 'lib', 'Artist One', 'Album B', 'CD1', '01 Disc One.flac'), {
    frequency: 262,
    tags: { ...second, title: 'Disc One', track: '1', disc: '1', genre: 'Jazz' },
  });
  makeTone(join(building, 'lib', 'Artist One', 'Album B', 'CD2', '01 Disc Two.flac'), {
    frequency: 294,
    tags: { ...second, title: 'Disc Two', track: '1', disc: '2' },
  });
  makeImage(join(building, 'lib', 'Artist One', 'Album B', 'folder.jpg'), 'green');
  makeImage(join(building, 'lib', 'Artist One', 'Album B', 'AlbumArtSmall.jpg'), 'yellow');
  makeImage(join(building, 'lib', 'Artist One', 'Album B', 'AlbumArt_{ABCD-1234}_Large.jpg'), 'yellow');

  makeTone(join(building, 'lib', 'Björk', 'Homogenic', 'Jóga.mp3'), {
    frequency: 330,
    picture: blue,
    tags: { artist: 'Björk', album_artist: 'Björk', album: 'Homogenic', title: 'Jóga', date: '1997', track: '2' },
  });
  makeTone(join(building, 'lib', 'The Beatles', 'Single.mp3'), {
    frequency: 349,
    tags: { artist: 'The Beatles', title: 'Single' },
  });
  makeTone(join(building, 'lib', 'No Tags', 'untagged.flac'), { frequency: 392 });

  mkdirSync(join(building, 'lib', 'Broken'), { recursive: true });
  writeFileSync(join(building, 'lib', 'Broken', 'corrupt.flac'), 'this is not a flac file at all');
  writeFileSync(join(building, 'lib', 'Broken', 'empty.mp3'), '');
  writeFileSync(join(building, 'lib', 'notes.txt'), 'ignored');

  const skipped = join(building, 'lib', 'Björk', 'Homogenic', 'Jóga.mp3');
  for (const folder of ['.player', '$RECYCLE.BIN', 'System Volume Information']) {
    mkdirSync(join(building, 'lib', folder), { recursive: true });
    cpSync(skipped, join(building, 'lib', folder, 'skip me.mp3'));
  }
  cpSync(skipped, join(building, 'lib', 'Björk', '._Jóga.mp3'));

  try {
    renameSync(join(building, 'lib'), base);
  } catch {
    // Another test file got there first, with the same contents.
  }
  rmSync(building, { recursive: true, force: true });
  return base;
}

export const BASE_FILES_READABLE = 7;

/** The base library, in a folder this test can change. */
export function copyOfBaseLibrary(label: string): string {
  const dir = tempDir(label);
  cpSync(baseLibrary(), dir, { recursive: true, preserveTimestamps: true });
  return dir;
}

export function openTestDatabase(dir: string): { dbPath: string; backupsDir: string; db: Connection } {
  const dbPath = join(dir, 'library.db');
  const backupsDir = join(dir, 'backups');
  const opened = openDatabase(dbPath, { backupsDir, now: Date.now() });
  if (opened.kind !== 'open') throw new Error(`Could not open a test database: ${opened.kind}`);
  return { dbPath, backupsDir, db: opened.db };
}

export function closeTestDatabase(db: Connection): void {
  if (db.open) closeCleanly(db);
}

type ScanOptions = Partial<Pick<ScanDeps, 'isCancelled' | 'onProgress' | 'onCommit' | 'hostname' | 'now'>>;

/** The real scan on its own connection, as the worker would run it. */
export async function scan(root: string, dbPath: string, options: ScanOptions = {}): Promise<ScanOutcome> {
  const db = connect(dbPath);
  try {
    return await runScan({
      root,
      db,
      hostname: hostname(),
      now: Date.now,
      isCancelled: () => false,
      onProgress: () => {},
      onCommit: () => {},
      ...options,
    });
  } finally {
    db.close();
  }
}

export async function finishedScan(root: string, dbPath: string, options: ScanOptions = {}) {
  const outcome = await scan(root, dbPath, options);
  if (outcome.kind !== 'finished') throw new Error(`Expected the scan to finish, got ${outcome.kind}`);
  return outcome;
}

/** Name, size and modified time of everything under a folder: what no scan may ever change. */
export function snapshot(root: string): string[] {
  const entries: string[] = [];
  const visit = (dir: string) => {
    for (const name of readdirSync(dir).toSorted()) {
      const path = join(dir, name);
      const stats = statSync(path);
      entries.push(`${path}|${stats.size}|${stats.mtimeMs}|${stats.isDirectory() ? 'dir' : hashOf(path)}`);
      if (stats.isDirectory()) visit(path);
    }
  };
  visit(root);
  return entries;
}

function hashOf(path: string): string {
  return createHash('sha1').update(readFileSync(path)).digest('hex');
}

/** The real scan, run in this thread instead of a worker, because Vitest can't load `?modulePath`. */
export function scanInProcess(): ScanRunner {
  return ({ root, dbPath, hostname: host }, onEvent) => {
    let cancelled = false;
    const db = connect(dbPath);
    void runScan({
      root,
      db,
      hostname: host,
      now: Date.now,
      isCancelled: () => cancelled,
      onProgress: (progress) => onEvent({ type: 'progress', progress }),
      onCommit: () => onEvent({ type: 'committed' }),
    })
      .then((outcome) => {
        db.close();
        onEvent({ type: 'done', outcome });
      })
      .catch((error: unknown) => {
        db.close();
        onEvent({ type: 'failed', message: String(error), code: (error as { code?: string }).code ?? null });
      });
    return {
      cancel() {
        cancelled = true;
      },
      async terminate() {
        cancelled = true;
        await Promise.resolve();
      },
    };
  };
}

export function maintenanceInProcess(): MaintenanceRunner {
  return (job, onEvent) => {
    runMaintenance(job, onEvent);
    return { stop: () => Promise.resolve() };
  };
}

/** The real art queue, in this thread. Counts how many workers were asked for. */
export function artInProcess(): { start: ArtWorkerStarter; started: () => number } {
  let started = 0;
  return {
    started: () => started,
    start: (config, onEvent) => {
      started++;
      let finish = (): void => {};
      const exited = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const queue = createArtQueue({ ...config, onDone: (result) => onEvent({ type: 'done', result }) });
      return {
        post(command) {
          if (command.type === 'job') queue.push(command.job, command.urgent);
          else if (command.type === 'drop-background') queue.dropBackground();
          else void queue.stop().then(finish);
        },
        terminate: async () => {
          await queue.stop();
          finish();
        },
        exited,
      };
    },
  };
}
