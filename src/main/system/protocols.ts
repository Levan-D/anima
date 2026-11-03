import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { net, protocol } from 'electron';
import type { ArtSize } from '@shared/domain';
import { log } from '@main/system/logging';
import { parseArtUrl, resolveBundlePath } from '@main/system/protocolUrls';

const notFound = () => new Response('Not found', { status: 404 });

// Named by the hash of its bytes, so the same URL can never mean a different image.
const CACHE_FOREVER = 'public, max-age=31536000, immutable';

// Scripts only from the app's own files, so text that came from outside can never run even if it reached the page as
// HTML. Styles may be inline, since components set them as they render. The dev server is left without it: its live
// reload is an inline script.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' art: data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' art:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function withPolicy(response: Response): Response {
  if (!(response.headers.get('content-type') ?? '').includes('text/html')) return response;
  const headers = new Headers(response.headers);
  headers.set('content-security-policy', CONTENT_SECURITY_POLICY);
  return new Response(response.body, { status: response.status, headers });
}

/** Must run before the app is ready, and only once. */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
    // corsEnabled: Media Session refuses art:// URLs, so overlay art has to be read back into a data URL.
    { scheme: 'art', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  ]);
}

type ResolveArt = (hash: string, size: ArtSize) => Promise<{ path: string; mime: string } | null>;

export function handleProtocols(bundleRoot: string, resolveArt: ResolveArt): void {
  protocol.handle('app', async (request) => {
    const file = resolveBundlePath(bundleRoot, request.url);
    if (file === null) return notFound();
    try {
      return withPolicy(await net.fetch(pathToFileURL(file).toString()));
    } catch {
      return notFound();
    }
  });

  protocol.handle('art', async (request) => {
    const art = parseArtUrl(request.url);
    if (art === null) {
      log.warn('Rejected art URL', request.url);
      return notFound();
    }
    try {
      const file = await resolveArt(art.hash, art.size);
      if (file === null) return notFound();
      const bytes = await readFile(file.path);
      return new Response(bytes, { headers: { 'content-type': file.mime, 'cache-control': CACHE_FOREVER } });
    } catch (error) {
      log.warn('Could not serve art', art.hash, error);
      return notFound();
    }
  });
}
