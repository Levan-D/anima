import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_ENTRY_URL, originOf, parseArtUrl, resolveBundlePath } from '@main/system/protocolUrls';

const root = resolve('out', 'renderer');

describe('resolveBundlePath', () => {
  it('maps a request to a file in the bundle', () => {
    expect(resolveBundlePath(root, APP_ENTRY_URL)).toBe(join(root, 'index.html'));
    expect(resolveBundlePath(root, 'app://bundle/assets/index-abc.js')).toBe(join(root, 'assets', 'index-abc.js'));
  });

  it('serves the entry page for the root', () => {
    expect(resolveBundlePath(root, 'app://bundle/')).toBe(join(root, 'index.html'));
  });

  it('decodes the path', () => {
    expect(resolveBundlePath(root, 'app://bundle/my%20file.js')).toBe(join(root, 'my file.js'));
  });

  it('ignores the query', () => {
    expect(resolveBundlePath(root, 'app://bundle/a.js?v=1')).toBe(join(root, 'a.js'));
  });

  it.each([
    ['parent folders, encoded', 'app://bundle/..%2f..%2fpackage.json'],
    ['parent folders, backslashes', 'app://bundle/..%5c..%5cpackage.json'],
    ['a partial escape', 'app://bundle/assets/..%2f..%2f..%2fsecret'],
    ['an absolute drive path', 'app://bundle/C:/Windows/win.ini'],
    ['an encoded drive path', 'app://bundle/C%3A%5CWindows%5Cwin.ini'],
    ['the wrong host', 'app://elsewhere/index.html'],
    ['broken percent-encoding', 'app://bundle/%E0%A4%A'],
    ['not a URL at all', 'nonsense'],
  ])('refuses %s', (_name, url) => {
    expect(resolveBundlePath(root, url)).toBeNull();
  });
});

describe('originOf', () => {
  it('gives the real origin of the app scheme, which URL.origin does not', () => {
    expect(new URL(APP_ENTRY_URL).origin).toBe('null');
    expect(originOf(APP_ENTRY_URL)).toBe('app://bundle');
  });

  it('works for the dev server', () => {
    expect(originOf('http://localhost:5173/')).toBe('http://localhost:5173');
  });
});

describe('parseArtUrl', () => {
  it('accepts a size and a hash', () => {
    expect(parseArtUrl('art://thumb/0123456789abcdef')).toEqual({ size: 'thumb', hash: '0123456789abcdef' });
    expect(parseArtUrl('art://full/0123456789abcdef')).toEqual({ size: 'full', hash: '0123456789abcdef' });
  });

  it.each([
    'art://huge/0123456789abcdef',
    'art://thumb/not-hex!',
    'art://thumb/ABCDEF0123456789',
    'art://thumb/abc',
    'art://thumb/0123456789abcdef/../../etc',
    'art://thumb/..%2f..%2fetc',
    'art://thumb/0123456789abcdef?x=1',
    'app://thumb/0123456789abcdef',
  ])('refuses %s', (url) => {
    expect(parseArtUrl(url)).toBeNull();
  });
});
