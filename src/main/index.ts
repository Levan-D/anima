import { hostname } from 'node:os';
import { join } from 'node:path';
import { app, dialog, Menu } from 'electron';
import type { Result } from '@shared/result';
import { maintenanceInWorker } from '@main/db/maintenance';
import maintenanceWorkerPath from '@main/db/maintenance.worker?modulePath';
import { bindCommands, emit, notify } from '@main/ipc';
import artWorkerPath from '@main/library/art.worker?modulePath';
import { artInWorker, createArtCache } from '@main/library/artCache';
import { libraryHandlers } from '@main/library/handlers';
import { createLibrary } from '@main/library/library';
import scanWorkerPath from '@main/library/scan.worker?modulePath';
import { scanInWorker } from '@main/library/scanner';
import { statsNotBuilt, waveformNotBuilt } from '@main/notBuilt';
import { importInWorker } from '@main/lyrics/import';
import importWorkerPath from '@main/lyrics/import.worker?modulePath';
import { createLrclibClient } from '@main/lyrics/lrclib';
import { createLyrics, lyricsHandlers } from '@main/lyrics/lyrics';
import { playerHandlers } from '@main/playback/handlers';
import { createPlayer } from '@main/playback/player';
import { playlistHandlers } from '@main/playlists/handlers';
import { openSettings, settingsHandlers } from '@main/settings/settings';
import { resolveBinaries } from '@main/system/binaries';
import { startCrashRecovery } from '@main/system/crashRecovery';
import { log, logHandlers, startLogging } from '@main/system/logging';
import { handleProtocols, registerSchemes } from '@main/system/protocols';
import { applySecurity, isAllowedSender } from '@main/system/security';
import { storageHandlers } from '@main/system/storage';
import { createThumbar } from '@main/system/thumbar';
import { focusMainWindow, openMainWindow, pickFolder, pickLyricsLibrary, windowHandlers } from '@main/system/windows';

const APP_ID = 'com.levan.musicplayer';
const QUIT_TIMEOUT_MS = 8_000;

startLogging();
startCrashRecovery();
registerSchemes();
app.setAppUserModelId(APP_ID);
Menu.setApplicationMenu(null);

function start(): void {
  const appRoot = app.getAppPath();
  const userData = app.getPath('userData');
  const settingsPath = join(userData, 'settings.json');
  const settings = openSettings(settingsPath, {
    onError: (message, error) => log.error(message, error),
  });
  settings.onChange((next) => emit('settings.changed', next));

  const binaries = resolveBinaries({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, appRoot });
  log.info('Binaries', binaries);

  const art = createArtCache({
    cacheDir: join(userData, 'art-cache'),
    ffmpegPath: binaries.ffmpeg.found ? binaries.ffmpeg.path : null,
    start: artInWorker(artWorkerPath),
    log,
  });

  // An unpackaged build never writes to a music folder, even when it's started without dev-env.sh.
  const devDataRoot = process.env.MUSIC_PLAYER_DATA_DIR ?? (app.isPackaged ? null : join(appRoot, '.dev', 'data'));

  const library = createLibrary({
    settings,
    emit,
    notify,
    log,
    pickFolder,
    devDataRoot,
    hostname: hostname(),
    now: Date.now,
    art,
    runScan: scanInWorker(scanWorkerPath),
    runMaintenance: maintenanceInWorker(maintenanceWorkerPath),
  });
  library.open();

  const player = createPlayer({
    settings,
    library,
    emit,
    notify,
    log,
    now: Date.now,
    enginePath: binaries.mpv.path,
  });

  const lyrics = createLyrics({
    library,
    settings,
    emit,
    log,
    now: Date.now,
    lrclib: createLrclibClient(`music-player v${app.getVersion()} (personal local player)`),
    pickFile: pickLyricsLibrary,
    runImport: importInWorker(importWorkerPath),
  });

  let closed = false;
  app.on('will-quit', (event) => {
    player.quit();
    settings.flush();
    if (closed) return;
    event.preventDefault();
    const timeout = new Promise((resolve) => setTimeout(resolve, QUIT_TIMEOUT_MS));
    Promise.race([library.close(), timeout])
      .catch((error: unknown) => log.error('Could not close the library', error))
      .finally(() => {
        closed = true;
        // Electron ignores a quit made while it's still emitting will-quit, which this can be when nothing was open.
        setImmediate(() => app.quit());
      });
  });

  applySecurity();
  handleProtocols(join(appRoot, 'out', 'renderer'), (hash, size) => art.resolve(hash, size));
  bindCommands(
    {
      ...libraryHandlers(library),
      ...playerHandlers(player),
      ...playlistHandlers({ library, emit, now: Date.now }),
      ...lyricsHandlers(lyrics),
      ...waveformNotBuilt,
      ...statsNotBuilt,
      ...settingsHandlers(settings),
      ...logHandlers,
      ...storageHandlers(library, art, binaries, { settingsPath, logsPath: join(userData, 'logs') }),
      ...windowHandlers,
    },
    isAllowedSender,
  );

  const tellIfRefused = (result: Result<void>) => {
    if (!result.ok) notify('error', result.error.message);
  };
  const thumbar = createThumbar(join(app.isPackaged ? process.resourcesPath : join(appRoot, 'resources'), 'icons'), {
    previous: () => tellIfRefused(player.previous()),
    toggle: () => tellIfRefused(player.toggle()),
    next: () => tellIfRefused(player.next()),
  });
  thumbar.update(player.state());
  player.onState(thumbar.update);

  openMainWindow(
    settings,
    { onStateChange: (state) => emit('window.state', state), onTaskbarWindow: thumbar.showOn },
    // Not sooner. A spawn hands the child every inheritable handle in this process, and Chromium's channel to a renderer
    // it's launching is one. A copy of that left in mpv means main never hears that the renderer died.
    () => player.start(),
  );
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
