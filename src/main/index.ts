import { hostname } from 'node:os';
import { join } from 'node:path';
import { app, dialog, Menu, powerMonitor, powerSaveBlocker } from 'electron';
import type { Result } from '@shared/result';
import { createDatasets, datasetHandlers } from '@main/datasets/datasets';
import backupCheckWorkerPath from '@main/db/backupCheck.worker?modulePath';
import { findBackupInWorker } from '@main/db/backups';
import { maintenanceInWorker } from '@main/db/maintenance';
import { createFingerprintDataset, fingerprintsInWorker } from '@main/fingerprints/fingerprints';
import fingerprintWorkerPath from '@main/fingerprints/fingerprints.worker?modulePath';
import maintenanceWorkerPath from '@main/db/maintenance.worker?modulePath';
import { bindCommands, emit, notify } from '@main/ipc';
import artWorkerPath from '@main/library/art.worker?modulePath';
import { artInWorker, createArtCache } from '@main/library/artCache';
import { libraryDataset } from '@main/library/dataset';
import { libraryHandlers } from '@main/library/handlers';
import { libraryPaths } from '@main/library/dataDir';
import { createLibrary } from '@main/library/library';
import scanWorkerPath from '@main/library/scan.worker?modulePath';
import { scanInWorker } from '@main/library/scanner';
import { createDiscoverAdapter } from '@main/listeners/discoverAdapter';
import { createListenerDataset } from '@main/listeners/listeners';
import { createServiceClient } from '@main/listeners/services';
import { importInWorker } from '@main/lyrics/import';
import importWorkerPath from '@main/lyrics/import.worker?modulePath';
import { createLrclibClient } from '@main/lyrics/lrclib';
import { createLyrics, lyricsHandlers } from '@main/lyrics/lyrics';
import { createLyricsAdapter } from '@main/lyrics/lyricsAdapter';
import { playerHandlers } from '@main/playback/handlers';
import { createPlayer } from '@main/playback/player';
import { createResumeStore } from '@main/playback/resumeStore';
import { playlistHandlers } from '@main/playlists/handlers';
import { createReport, reportHandlers, reportInWorker } from '@main/report/report';
import reportWorkerPath from '@main/report/report.worker?modulePath';
import { createRecommender, recommendHandlers } from '@main/recommend/recommender';
import { themeMarkHandlers } from '@main/recommend/themeMarks';
import recommendWorkerPath from '@main/recommend/recommend.worker?modulePath';
import { onlineServiceHandlers, serviceWhere } from '@main/online/onlineServices';
import { scriptFor } from '@shared/onlineServices';
import { runScript } from '@main/online/sandbox';
import { openSettings, settingsHandlers } from '@main/settings/settings';
import { createStats, statsHandlers } from '@main/stats/stats';
import { resolveBinaries } from '@main/system/binaries';
import { startCrashRecovery } from '@main/system/crashRecovery';
import { log, logHandlers, startLogging } from '@main/system/logging';
import { createPowerKeeper } from '@main/system/powerKeeper';
import { handleProtocols, registerSchemes } from '@main/system/protocols';
import { applySecurity, isAllowedSender } from '@main/system/security';
import { storageHandlers } from '@main/system/storage';
import { createThumbar } from '@main/system/thumbar';
import { eqPresetHandlers } from '@main/eq/presets';
import { headphoneHandlers, matchInWorker } from '@main/headphones/headphones';
import matchWorkerPath from '@main/headphones/match.worker?modulePath';
import {
  pickEqFile,
  pickEqSavePath,
  pickFolder,
  pickFrequencyResponse,
  pickLyricsFile,
  pickLyricsLibrary,
  pickPlaylistFile,
  pickPlaylistSavePath,
} from '@main/system/dialogs';
import { focusMainWindow, openMainWindow, windowHandlers } from '@main/system/windows';
import waveformWorkerPath from '@main/waveform/waveform.worker?modulePath';
import { createWaveforms, waveformHandlers, waveformInWorker } from '@main/waveform/waveforms';

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
  // An unpackaged build never writes to a music folder, even when it's started without dev-env.sh.
  const devDataRoot = process.env.MUSIC_PLAYER_DATA_DIR ?? (app.isPackaged ? null : join(appRoot, '.dev', 'data'));
  const pathsFor = (folder: string) => libraryPaths(folder, devDataRoot);

  const settingsPath = join(userData, 'settings.json');
  const settings = openSettings(
    { path: settingsPath, libraryFileFor: (folder) => pathsFor(folder).settingsPath },
    { onError: (message, error) => log.error(message, error) },
  );
  settings.onChange((next) => emit('settings.changed', next));

  const binaries = resolveBinaries({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, appRoot });
  log.info('Binaries', binaries);

  const art = createArtCache({
    cacheDir: join(userData, 'art-cache'),
    ffmpegPath: binaries.ffmpeg.found ? binaries.ffmpeg.path : null,
    start: artInWorker(artWorkerPath),
    log,
  });

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
    findBackup: findBackupInWorker(backupCheckWorkerPath),
  });
  library.open();

  const stats = createStats({ library, emit, now: Date.now, log });

  const recommender = createRecommender({
    library,
    workerPath: recommendWorkerPath,
    modelsDir: binaries.modelsDir,
    seasons: () => settings.get().seasons,
    log,
  });

  const player = createPlayer({
    settings,
    library,
    emit,
    notify,
    log,
    now: Date.now,
    enginePath: binaries.mpv.path,
    listening: stats.listening,
    suggest: (ask) => recommender.suggest(ask),
    pickRadioSeed: () => recommender.pickSeed(),
    radioStart: (from, wander, energy, count) => recommender.radioStart(from, wander, energy, count),
    resume: createResumeStore(library, log),
  });

  const powerKeeper = createPowerKeeper({ settings, blocker: powerSaveBlocker, monitor: powerMonitor });
  player.onState(powerKeeper.onPlayerState);

  const userAgent = `music-player v${app.getVersion()} (personal local player)`;
  const lrclib = createLrclibClient(userAgent, serviceWhere(settings, 'lrclib'));
  const lyricsScript = () => settings.get().onlineServices.lrclib.script;
  const lyricsAdapter = createLyricsAdapter({ script: lyricsScript, userAgent, run: runScript });
  const listenerClient = createServiceClient(userAgent, {
    musicbrainz: serviceWhere(settings, 'musicbrainz'),
    listenbrainz: serviceWhere(settings, 'listenbrainz'),
  });
  const discoverScript = () => scriptFor(settings.get().onlineServices, 'listenbrainz');
  const discoverAdapter = createDiscoverAdapter({ script: discoverScript, userAgent, run: runScript });
  const lyrics = createLyrics({
    library,
    settings,
    emit,
    log,
    now: Date.now,
    lrclib,
    byScript: lyricsAdapter,
    pickFile: pickLyricsLibrary,
    pickLyricsFile,
    runImport: importInWorker(importWorkerPath),
  });

  const waveforms = createWaveforms({
    library,
    ffmpegPath: binaries.ffmpeg.found ? binaries.ffmpeg.path : null,
    run: waveformInWorker(waveformWorkerPath),
    nextTrackId: () => player.nextTrackId(),
    now: Date.now,
    log,
  });

  const report = createReport({ library, art, run: reportInWorker(reportWorkerPath), emit, log });

  const announceRecommendations = () => emit('library.changed', { scopes: ['recommendations'] });
  const datasets = createDatasets({
    library,
    emit,
    log,
    now: Date.now,
    datasets: {
      library: libraryDataset(library),
      lyrics: lyrics.dataset,
      fingerprints: createFingerprintDataset({
        library,
        modelPath: binaries.fingerprintModel.path,
        ffmpegPath: binaries.ffmpeg.found ? binaries.ffmpeg.path : null,
        run: fingerprintsInWorker(fingerprintWorkerPath),
        announce: announceRecommendations,
        log,
        now: Date.now,
      }),
      listeners: createListenerDataset({
        library,
        client: listenerClient,
        script: discoverScript,
        byScript: discoverAdapter,
        isOn: (service) => settings.get().onlineServices[service].isOn,
        announce: announceRecommendations,
        log,
        now: Date.now,
      }),
    },
  });

  let closed = false;
  app.on('will-quit', (event) => {
    powerKeeper.stop();
    player.quit();
    waveforms.stop();
    settings.flush();
    if (closed) return;
    event.preventDefault();
    const timeout = new Promise((resolve) => setTimeout(resolve, QUIT_TIMEOUT_MS));
    const closing = Promise.all([datasets.stop(), recommender.stop(), report.stop()]).then(() => library.close());
    Promise.race([closing, timeout])
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
      ...reportHandlers(report),
      ...playerHandlers(player),
      ...playlistHandlers({
        library,
        emit,
        now: Date.now,
        pickExportPath: pickPlaylistSavePath,
        pickImportFile: pickPlaylistFile,
      }),
      ...lyricsHandlers(lyrics),
      ...waveformHandlers(waveforms),
      ...statsHandlers(stats),
      ...recommendHandlers(recommender),
      ...themeMarkHandlers({
        library,
        emit,
        onMarked: () => {
          recommender.noteThemeMarks();
          player.setSeasons(settings.get().seasons);
        },
      }),
      ...datasetHandlers(datasets),
      ...settingsHandlers(settings),
      ...onlineServiceHandlers({
        settings,
        tests: {
          lrclib: () => (lyricsScript() === null ? lrclib.test() : lyricsAdapter.test()),
          musicbrainz: () => listenerClient.test('musicbrainz'),
          listenbrainz: () =>
            discoverScript() === null ? listenerClient.test('listenbrainz') : discoverAdapter.test(),
        },
        onChange: () => datasets.refresh(),
        now: () => performance.now(),
      }),
      ...eqPresetHandlers({
        settings,
        setEq: (eq) => player.setEq(eq),
        pickFile: pickEqFile,
        pickSavePath: pickEqSavePath,
      }),
      ...headphoneHandlers({
        dir: () => {
          const folder = settings.get().libraryFolder;
          return folder === null ? null : pathsFor(folder).headphonesDir;
        },
        settings,
        setEq: (eq) => player.setEq(eq),
        pickFile: pickFrequencyResponse,
        runMatch: matchInWorker(matchWorkerPath),
        log,
      }),
      ...logHandlers,
      ...storageHandlers(library, art, binaries, { settingsPath, logsPath: join(userData, 'logs') }),
      ...windowHandlers,
    },
    isAllowedSender,
  );

  const tellIfRefused = (result: Result<void>) => {
    if (!result.ok) notify('error', result.error.message);
  };
  settings.onLibraryChange(() => tellIfRefused(player.takeUpLibrarySettings()));
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
