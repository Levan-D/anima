import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { libraryStatus } from '@main/library/status';

describe('libraryStatus', () => {
  it('asks for a folder when none is set', () => {
    expect(libraryStatus(null)).toEqual({ state: 'no-folder' });
  });

  it('says so when the folder is gone', () => {
    const folder = resolve('.dev/no-such-folder');
    expect(libraryStatus(folder)).toEqual({ state: 'folder-missing', folder });
  });

  it('is ready when the folder is there', () => {
    const folder = resolve('.');
    expect(libraryStatus(folder)).toMatchObject({ state: 'ready', folder });
  });
});
