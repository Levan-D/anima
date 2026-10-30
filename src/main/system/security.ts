import { app, session, type WebFrameMain } from 'electron';
import { log } from '@main/system/logging';
import { originOf } from '@main/system/protocolUrls';
import { rendererUrl } from '@main/system/windows';

export function isAllowedSender(frame: WebFrameMain | null): boolean {
  return frame !== null && frame.origin === originOf(rendererUrl());
}

export function applySecurity(): void {
  const origin = originOf(rendererUrl());
  const isRenderer = (url: string) => URL.canParse(url) && originOf(url) === origin;

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (isRenderer(url)) return;
      event.preventDefault();
      log.warn('Blocked navigation to', url);
    });

    // will-navigate never fires for about:blank, and that frame even keeps the app's origin. DevTools has its own URL.
    if (contents.getType() === 'window') {
      contents.on('did-navigate', (_event, url) => {
        if (isRenderer(url)) return;
        log.warn('The window left the app for', url);
        contents.loadURL(rendererUrl()).catch((error: unknown) => log.error('Could not load the renderer', error));
      });
    }

    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      log.warn('Blocked a new window for', url);
      return { action: 'deny' };
    });
  });

  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
}
