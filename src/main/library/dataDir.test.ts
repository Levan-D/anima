import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { libraryPaths, writeProblem } from '@main/library/dataDir';
import { tempDir } from '@main/library/testFixtures';

describe('libraryPaths', () => {
  it('lives in the music folder in a real run', () => {
    const paths = libraryPaths('D:\\Music', null);
    expect(paths.dataDir).toBe(join('D:\\Music', '.player'));
    expect(paths.dbPath).toBe(join('D:\\Music', '.player', 'library.db'));
    expect(paths.backupsDir).toBe(join('D:\\Music', '.player', 'backups'));
  });

  it('stays out of the music folder when a development root is set', () => {
    const paths = libraryPaths('D:\\Music', 'C:\\repo\\.dev\\data');
    expect(paths.dataDir.startsWith('C:\\repo\\.dev\\data\\')).toBe(true);
    expect(paths.dbPath).not.toContain('Music');
  });

  it('uses the first 8 hex of the path hash, so two folders never share a database', () => {
    const one = libraryPaths('D:\\Music', 'C:\\dev');
    const other = libraryPaths('D:\\Other', 'C:\\dev');
    expect(one.dataDir).toMatch(/\\[0-9a-f]{8}$/);
    expect(one.dataDir).not.toBe(other.dataDir);
  });

  it('treats different spellings of one folder as one folder', () => {
    const one = libraryPaths('D:\\Music', 'C:\\dev');
    expect(libraryPaths('d:\\music', 'C:\\dev').dataDir).toBe(one.dataDir);
    expect(libraryPaths('D:\\Music\\', 'C:\\dev').dataDir).toBe(one.dataDir);
  });
});

describe('writeProblem', () => {
  it('creates the folder and leaves nothing behind', () => {
    const dir = join(tempDir('writable'), 'a', 'b');
    expect(writeProblem(dir)).toBeNull();
    expect(writeProblem(dir)).toBeNull();
  });

  it('explains when the folder cannot be created', () => {
    const parent = tempDir('blocked');
    const file = join(parent, 'in-the-way');
    writeFileSync(file, '');
    expect(writeProblem(join(file, 'sub'))).toBeInstanceOf(Error);
  });

  it('explains when a file is where the folder should be', () => {
    const parent = tempDir('blocked');
    mkdirSync(parent, { recursive: true });
    const file = join(parent, 'in-the-way');
    writeFileSync(file, '');
    expect(writeProblem(file)).toBeInstanceOf(Error);
  });
});
