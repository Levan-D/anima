import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nearestFolder } from '@main/system/nearestFolder';

const ROOT = join('D:', 'Music');
const ALBUM = join(ROOT, 'Artist', 'Album');
const FILE = join(ALBUM, 'Track.flac');

describe('nearestFolder', () => {
  it('is the file’s own folder when that is still there', () => {
    expect(nearestFolder(FILE, ROOT, (path) => path === ALBUM)).toBe(ALBUM);
  });

  it('goes up as far as it has to', () => {
    expect(nearestFolder(FILE, ROOT, (path) => path === join(ROOT, 'Artist'))).toBe(join(ROOT, 'Artist'));
    expect(nearestFolder(FILE, ROOT, (path) => path === ROOT)).toBe(ROOT);
  });

  it('stops at the library folder, so a drive that went away gets nothing to open', () => {
    expect(nearestFolder(FILE, ROOT, (path) => path === 'D:\\')).toBeNull();
    expect(nearestFolder(FILE, ROOT, () => false)).toBeNull();
  });

  it('works with the library at the root of a drive', () => {
    const drive = 'D:\\';
    expect(nearestFolder('D:\\Album\\Track.flac', drive, (path) => path === drive)).toBe(drive);
  });
});
