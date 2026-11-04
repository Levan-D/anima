import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readM3u, writeM3u } from './m3u';

describe('readM3u', () => {
  const base = resolve('/playlists');

  it('reads relative, absolute and file: lines, with their #EXTINF names, and skips streams', () => {
    const absolute = resolve('/music/b.flac');
    const text = [
      '\uFEFF#EXTM3U',
      '#PLAYLIST:Road trip',
      '#EXTINF:120,Someone - First, part two',
      'songs/a.mp3',
      absolute,
      '#EXTINF:-1,Radio',
      'http://example.com/stream',
      pathToFileURL(resolve('/music/c d.flac')).href,
    ].join('\r\n');
    expect(readM3u(text, base)).toEqual({
      name: 'Road trip',
      entries: [
        { path: join(base, 'songs', 'a.mp3'), artist: 'Someone', title: 'First, part two' },
        { path: absolute, artist: null, title: null },
        { path: resolve('/music/c d.flac'), artist: null, title: null },
      ],
    });
  });

  it('reads back what it writes', () => {
    const path = resolve('/music/a.flac');
    const text = writeM3u('Mix', [{ path, seconds: 61.4, artist: 'A', title: 'Song' }]);
    expect(text).toBe(`#EXTM3U\r\n#PLAYLIST:Mix\r\n#EXTINF:61,A - Song\r\n${path}\r\n`);
    expect(readM3u(text, base).entries).toEqual([{ path, artist: 'A', title: 'Song' }]);
  });
});
