import { join } from 'node:path';
import { app } from 'electron';
import log from 'electron-log/main';
import { ok } from '@shared/result';
import type { HandlerGroup } from '@main/ipc';

export { log };

export function startLogging(): void {
  log.transports.file.resolvePathFn = () => join(app.getPath('userData'), 'logs', 'main.log');
  log.transports.ipc.level = false;

  process.on('uncaughtException', (error) => log.error('Uncaught exception', error));
  process.on('unhandledRejection', (reason) => log.error('Unhandled rejection', reason));

  app.on('render-process-gone', (_event, _contents, details) => log.error('Renderer gone', details));
  app.on('child-process-gone', (_event, details) => log.warn('Child process gone', details));
}

export const logHandlers = {
  'system.logError': ({ message, stack }) => {
    log.error('Renderer error:', message, stack ?? '');
    return ok();
  },
} satisfies HandlerGroup;
