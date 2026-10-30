import { join } from 'node:path';
import { app, dialog, Menu } from 'electron';
import { bindCommands, emit } from '@main/ipc';
import { libraryHandlers } from '@main/library/status';
import {
  libraryNotBuilt,
  lyricsNotBuilt,
  miniPlayerNotBuilt,
  playerNotBuilt,
  playlistNotBuilt,
  scanNotBuilt,
  statsNotBuilt,
  storageNotBuilt,
  waveformNotBuilt,
} from '@main/notBuilt';
import { playerHandlers } from '@main/playback/idleState';
import { openSettings, settingsHandlers } from '@main/settings/settings';
import { resolveBinaries } from '@main/system/binaries';
import { startCrashRecovery } from '@main/system/crashRecovery';
import { log, logHandlers, startLogging } from '@main/system/logging';
import { handleProtocols, registerSchemes } from '@main/system/protocols';
import { applySecurity, isAllowedSender } from '@main/system/security';
import { focusMainWindow, openMainWindow, windowHandlers } from '@main/system/windows';

const APP_ID = 'com.levan.musicplayer';

startLogging();
startCrashRecovery();
registerSchemes();
app.setAppUserModelId(APP_ID);
Menu.setApplicationMenu(null);

function start(): void {
  const appRoot = app.getAppPath();
  const settings = openSettings(join(app.getPath('userData'), 'settings.json'), {
    onError: (message, error) => log.error(message, error),
  });
  app.on('will-quit', () => settings.flush());
  settings.onChange((next) => emit('settings.changed', next));

  log.info('Binaries', resolveBinaries({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, appRoot }));

  applySecurity();
  handleProtocols(join(appRoot, 'out', 'renderer'));
  bindCommands(
    {
      ...libraryHandlers(settings),
      ...libraryNotBuilt,
      ...scanNotBuilt,
      ...playerHandlers(settings),
      ...playerNotBuilt,
      ...playlistNotBuilt,
      ...lyricsNotBuilt,
      ...waveformNotBuilt,
      ...statsNotBuilt,
      ...settingsHandlers(settings),
      ...logHandlers,
      ...storageNotBuilt,
      ...windowHandlers,
      ...miniPlayerNotBuilt,
    },
    isAllowedSender,
  );

  openMainWindow(settings, (state) => emit('window.state', state));
}

if (app.requestSingleInstanceLock()) {
  app.on('second-instance', focusMainWindow);
  app.on('window-all-closed', () => app.quit());
  app
    .whenReady()
    .then(start)
    .catch((error: unknown) => {
      log.error('Startup failed', error);
      dialog.showErrorBox('Music Player could not start', error instanceof Error ? error.message : String(error));
      app.exit(1);
    });
} else {
  app.quit();
}
