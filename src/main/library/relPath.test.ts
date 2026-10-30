import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { byRelPath, caseKey, childPath, folderOf, nameOf, toAbsolute } from '@main/library/relPath';

describe('relPath', () => {
  it('turns a stored path into a real one', () => {
    expect(toAbsolute('D:\\Music', 'Artist/Album/Song.flac')).toBe(join('D:\\Music', 'Artist', 'Album', 'Song.flac'));
    expect(toAbsolute('D:\\Music', 'Song.flac')).toBe(join('D:\\Music', 'Song.flac'));
    expect(toAbsolute('D:\\Music', '')).toBe(join('D:\\Music'));
  });

  it('treats paths that differ only by case as one key', () => {
    expect(caseKey('Artist/SONG.flac')).toBe(caseKey('artist/song.FLAC'));
    expect(caseKey('Björk/Jóga.flac')).toBe(caseKey('BJÖRK/JÓGA.FLAC'));
    expect(caseKey('a/b.flac')).not.toBe(caseKey('a/c.flac'));
  });

  it('splits a path', () => {
    expect(folderOf('Artist/Album/Song.flac')).toBe('Artist/Album');
    expect(folderOf('Song.flac')).toBe('');
    expect(nameOf('Artist/Album/Song.flac')).toBe('Song.flac');
    expect(nameOf('Song.flac')).toBe('Song.flac');
  });

  it('joins a path', () => {
    expect(childPath('Artist', 'Song.flac')).toBe('Artist/Song.flac');
    expect(childPath('', 'Song.flac')).toBe('Song.flac');
  });

  it('sorts without minding case, and stays the same whatever order it starts in', () => {
    const paths = ['b.flac', 'A.flac', 'a.flac', 'C.flac'].map((relPath) => ({ relPath }));
    const sorted = paths.toSorted(byRelPath).map(({ relPath }) => relPath);
    expect(sorted).toEqual(['A.flac', 'a.flac', 'b.flac', 'C.flac']);
    expect(
      paths
        .toReversed()
        .toSorted(byRelPath)
        .map(({ relPath }) => relPath),
    ).toEqual(sorted);
  });
});
