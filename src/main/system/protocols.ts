import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { net, protocol } from 'electron';
import type { ArtSize } from '@shared/domain';
import { log } from '@main/system/logging';
import { parseArtUrl, resolveBundlePath } from '@main/system/protocolUrls';

const notFound = () => new Response('Not found', { status: 404 });

// Named by the hash of its bytes, so the same URL can never mean a different image.
const CACHE_FOREVER = 'public, max-age=31536000, immutable';

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
      return await net.fetch(pathToFileURL(file).toString());
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
