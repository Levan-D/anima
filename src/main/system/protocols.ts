import { pathToFileURL } from 'node:url';
import { net, protocol } from 'electron';
import { log } from '@main/system/logging';
import { parseArtUrl, resolveBundlePath } from '@main/system/protocolUrls';

const notFound = () => new Response('Not found', { status: 404 });

/** Must run before the app is ready, and only once. */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
    // corsEnabled: Media Session refuses art:// URLs, so overlay art has to be read back into a data URL.
    { scheme: 'art', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  ]);
}

export function handleProtocols(bundleRoot: string): void {
  protocol.handle('app', async (request) => {
    const file = resolveBundlePath(bundleRoot, request.url);
    if (file === null) return notFound();
    try {
      return await net.fetch(pathToFileURL(file).toString());
    } catch {
      return notFound();
    }
  });

  // TEMP: every art request is a 404 until Phase 2 serves the cache from here.
  protocol.handle('art', (request) => {
    if (parseArtUrl(request.url) === null) log.warn('Rejected art URL', request.url);
    return notFound();
  });
}
