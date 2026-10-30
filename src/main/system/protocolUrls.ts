import { isAbsolute, join, relative, sep } from 'node:path';
import { ART_SIZES, type ArtSize } from '@shared/domain';

const BUNDLE_HOST = 'bundle';

export const APP_ENTRY_URL = `app://${BUNDLE_HOST}/index.html`;

const ART_URL = new RegExp(`^art://(${ART_SIZES.join('|')})/([0-9a-f]{8,128})$`);

/** `URL.origin` is the string "null" for schemes Node doesn't know, such as `app:`. */
export function originOf(url: string): string {
  const { protocol, host } = new URL(url);
  return `${protocol}//${host}`;
}

export function resolveBundlePath(root: string, requestUrl: string): string | null {
  try {
    const url = new URL(requestUrl);
    if (url.host !== BUNDLE_HOST) return null;

    const path = decodeURIComponent(url.pathname);
    const file = join(root, path === '/' ? 'index.html' : path);
    const fromRoot = relative(root, file);
    const escapes = fromRoot === '' || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot);
    return escapes ? null : file;
  } catch {
    return null;
  }
}

export function parseArtUrl(url: string): { size: ArtSize; hash: string } | null {
  const match = ART_URL.exec(url);
  const size = ART_SIZES.find((artSize) => artSize === match?.[1]);
  const hash = match?.[2];
  return size && hash ? { size, hash } : null;
}
