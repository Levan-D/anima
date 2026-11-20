import { describe, expect, it } from 'vitest';
import { mpvPath } from './mpvPath';

const LONG_FOLDER = 'a-rather-long-folder-name'.repeat(10);

describe('mpvPath', () => {
  it('leaves a path under the limit as it is', () => {
    expect(mpvPath('D:\\Music\\Björk\\Jóga.flac')).toBe('D:\\Music\\Björk\\Jóga.flac');
    const justUnder = `D:\\${'x'.repeat(250)}\\a.flac`.slice(0, 259);
    expect(mpvPath(justUnder)).toBe(justUnder);
  });

  it('gives a long one the form that skips the limit', () => {
    const path = `D:\\Music\\${LONG_FOLDER}\\01 Song.flac`;
    expect(mpvPath(path)).toBe(`\\\\?\\${path}`);
  });

  it('makes it whole first, since that form takes it literally', () => {
    const path = `D:/Music/${LONG_FOLDER}/../${LONG_FOLDER}/01 Song.flac`;
    expect(mpvPath(path)).toBe(`\\\\?\\D:\\Music\\${LONG_FOLDER}\\01 Song.flac`);
  });

  it('writes a long network path the way that form wants it', () => {
    const path = `\\\\nas\\music\\${LONG_FOLDER}\\01 Song.flac`;
    expect(mpvPath(path)).toBe(`\\\\?\\UNC\\nas\\music\\${LONG_FOLDER}\\01 Song.flac`);
  });

  it('leaves one already in that form alone', () => {
    const path = `\\\\?\\D:\\Music\\${LONG_FOLDER}\\01 Song.flac`;
    expect(mpvPath(path)).toBe(path);
  });
});
