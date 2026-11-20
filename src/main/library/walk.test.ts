import { mkdirSync, symlinkSync } from 'node:fs';
import type * as FsPromises from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from '@main/db/connection';
import { createQueries } from '@main/library/queries';
import {
  closeTestDatabase,
  copyOfBaseLibrary,
  finishedScan,
  makeTone,
  openTestDatabase,
  tempDir,
} from '@main/library/testFixtures';
import { walkLibrary } from '@main/library/walk';

// Real files and real ffmpeg, on a machine shared with every other test file.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const failing = vi.hoisted(() => ({ stat: null as string | null, asReparsePoint: [] as string[] }));

// Windows won't refuse a stat for one chosen file on demand, and a failure there is what's being tested.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    stat: (path: string) =>
      failing.stat !== null && path.endsWith(failing.stat)
        ? Promise.reject(Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' }))
        : actual.stat(path),
    // What libuv's readdir says about any reparse point on Windows, OneDrive's files and folders among them.
    readdir: async (path: string, options: { withFileTypes: true }) => {
      const entries = await actual.readdir(path, options);
      return entries.map((entry) =>
        failing.asReparsePoint.includes(entry.name)
          ? Object.assign(Object.create(entry) as typeof entry, {
              isSymbolicLink: () => true,
              isDirectory: () => false,
              isFile: () => false,
            })
          : entry,
      );
    },
  };
});

const walk = (root: string) => walkLibrary(root, { isCancelled: () => false, onFound: () => {} });
const paths = (files: { relPath: string }[]) => files.map(({ relPath }) => relPath).toSorted();

let root: string;

beforeEach(() => {
  failing.stat = null;
  failing.asReparsePoint = [];
  root = tempDir('walk');
});

describe('walkLibrary', () => {
  it('finds music in a folder whose name starts with a dot', async () => {
    makeTone(join(root, '...And Justice For All', '01 Blackened.flac'), { frequency: 300 });
    makeTone(join(root, '.38 Special', 'Wild Eyed', 'Rockin.flac'), { frequency: 310 });
    const { files, unreadable } = await walk(root);
    expect(paths(files)).toEqual(['...And Justice For All/01 Blackened.flac', '.38 Special/Wild Eyed/Rockin.flac']);
    expect(unreadable).toEqual([]);
  });

  it('stays out of the app data and the system folders, whatever their case', async () => {
    for (const folder of ['.player', '.PLAYER', 'Album/.player', '$Recycle.Bin', 'SYSTEM VOLUME INFORMATION']) {
      makeTone(join(root, folder, 'skip.flac'), { frequency: 320 });
    }
    expect((await walk(root)).files).toEqual([]);
  });

  it('reports a junction it will not follow', async () => {
    const outside = tempDir('walk-outside');
    makeTone(join(outside, 'outside.flac'), { frequency: 330 });
    symlinkSync(outside, join(root, 'Linked'), 'junction');

    const { files, unreadable } = await walk(root);
    expect(files).toEqual([]);
    expect(unreadable).toEqual([{ relPath: 'Linked', message: expect.stringContaining('link') as string }]);
  });

  it('walks a file and a folder readdir calls links but that are not, as OneDrive has them', async () => {
    makeTone(join(root, 'Synced.flac'), { frequency: 340 });
    makeTone(join(root, 'Synced Album', 'Track.flac'), { frequency: 350 });
    const outside = tempDir('walk-outside');
    symlinkSync(outside, join(root, 'Linked'), 'junction');
    failing.asReparsePoint = ['Synced.flac', 'Synced Album', 'Linked'];

    const { files, unreadable } = await walk(root);
    expect(paths(files)).toEqual(['Synced Album/Track.flac', 'Synced.flac']);
    expect(unreadable).toEqual([{ relPath: 'Linked', message: expect.stringContaining('link') as string }]);
  });

  it('reports a file it could not look at, and leaves it out', async () => {
    makeTone(join(root, 'a.flac'), { frequency: 340 });
    makeTone(join(root, 'b.flac'), { frequency: 350 });
    failing.stat = 'a.flac';

    const { files, unreadable } = await walk(root);
    expect(paths(files)).toEqual(['b.flac']);
    expect(unreadable).toEqual([{ relPath: 'a.flac', message: expect.stringContaining('EBUSY') as string }]);
  });

  it('calls a folder it cannot list unreadable, and a root it cannot list the end of it', async () => {
    mkdirSync(join(root, 'Empty'));
    expect((await walk(join(root, 'nope'))).rootError).toEqual(expect.any(String));
    expect((await walk(root)).rootError).toBeNull();
  });
});

describe('what the walk could not look at, through a scan', () => {
  let library: string;
  let dbPath: string;
  let db: Connection;

  beforeEach(() => {
    library = copyOfBaseLibrary('walk-scan');
    ({ dbPath, db } = openTestDatabase(tempDir('walk-data')));
  });

  afterEach(() => closeTestDatabase(db));

  it('a file that could not be looked at is not marked missing', async () => {
    await finishedScan(library, dbPath);
    const queries = createQueries(db);

    failing.stat = '01 First.flac';
    const { report } = await finishedScan(library, dbPath);

    expect(report.nowMissing).toBe(0);
    expect(queries.tracks({ kind: 'missing' })).toEqual([]);
    expect(queries.issues()).toContainEqual(
      expect.objectContaining({ relPath: 'Artist One/Album A/01 First.flac', kind: 'unreadable' }),
    );
  });
});
